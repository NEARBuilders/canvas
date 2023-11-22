/**
 * Opens a modal
 * Takes in props.data
 * 
 * Ability to view/edit incoming data
 * 
 * Select a preset or create new
 * Shows the prompt (editable textarea)
 * Shows the modal (editable select)
 * 
 * Press submit
 * Async request through near-openai
 * If error, show error here and response data
 * If success, show the response data
 * Click apply or abandon changes
 */

const { data } = props; // incoming data

// should the data already hold the svg, text...
// how would the individual agents act?


// Sourced from
// https://github.com/petersalomonsen/near-openai/blob/main/boswidgets/askchatgpt/main.js

// TODO: Separate out into its own SDK

const NETWORK_ID = "mainnet";

// what does near-api-js use these for?
// and how can people discover other options
const NODE_URL = "https://rpc.mainnet.near.org";
const WALLET_URL = `https://wallet.${NETWORK_ID}.near.org`; // what should this be defaulting to?
const HELPER_URL = `https://helper.${NETWORK_ID}.near.org`;
const EXPLORER_URL = `https://explorer.${NETWORK_ID}.near.org`; // and this?

const API_URL = "https://near-openai.vercel.app/api/openai";

const code = `
<!DOCTYPE html>
<html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta charset="UTF-8">
    </head>
    <body>
    </body>
    <script type="module">

import 'https://cdn.jsdelivr.net/npm/near-api-js@2.1.3/dist/near-api-js.min.js';
import 'https://cdn.jsdelivr.net/npm/js-sha256@0.9.0/src/sha256.min.js';

const keyStore = new nearApi.keyStores.InMemoryKeyStore();
let account;
const networkId = "mainnet";

const config = {
    keyStore, // instance of UnencryptedFileSystemKeyStore
    networkId: networkId,
    nodeUrl:  "https://rpc.mainnet.near.org",
    walletUrl: "https://wallet.mainnet.near.org",
    helperUrl: "https://helper.mainnet.near.org",
    explorerUrl: "https://explorer.mainnet.near.org"
};


async function createAccount() {
    const keypair = nearApi.utils.KeyPairEd25519.fromRandom();
    const accountId = Buffer.from(keypair.publicKey.data).toString('hex');
    await keyStore.setKey(networkId, accountId, keypair);
    const near = await nearApi.connect(config);
    account = await near.account(accountId);
    return { secretKey: keypair.secretKey, accountId };
}

async function useAccount(secretKey) {
    const keypair = nearApi.utils.KeyPair.fromString(secretKey);
    const accountId = Buffer.from(keypair.publicKey.data).toString('hex');
    await keyStore.setKey(networkId, accountId, keypair);
    const near = await nearApi.connect(config);
    account = await near.account(accountId);
    return accountId;
}

async function create_ask_ai_request_body(messages, model) {
    const accountId = account.accountId;

    const messagesStringified = JSON.stringify(messages);
    const deposit = 50_00000_00000_00000_00000n;

    const message_hash = sha256(messagesStringified);

    const receiverId = 'jsinrust.near';
    const method_name = 'ask_ai';
    const gas = '30000000000000';
    const publicKey = await account.connection.signer.getPublicKey(account.accountId, account.connection.networkId);

    let accessKey;
    
    try {
      accessKey = (await account.findAccessKey()).accessKey;
    } catch (e) {
      throw new Error(JSON.stringify("Balance is empty.", null, 1));
    }

    const nonce = ++accessKey.nonce;
    const recentBlockHash = nearApi.utils.serialize.base_decode(
        accessKey.block_hash
    );

    const transaction = nearApi.transactions.createTransaction(
        account.accountId,
        publicKey,
        receiverId,
        nonce,
        [nearApi.transactions.functionCall(method_name, {
            message_hash
        }, gas, deposit)],
        recentBlockHash
    );
    const [txHash, signedTx] = await nearApi.transactions.signTransaction(transaction, account.connection.signer, account.accountId, account.connection.networkId);

    return JSON.stringify({
        signed_transaction: Buffer.from(signedTx.encode()).toString('base64'),
        transaction_hash: nearApi.utils.serialize.base_encode(txHash),
        sender_account_id: accountId,
        messages: messages,
        model: model
    });
}

async function create_and_send_ask_ai_request(messages, model) {
    console.log("model", model);
    try {
        const requestbody = await create_ask_ai_request_body(messages, model);
        const airesponse = await fetch(
            "https://near-openai-50jjawxtf-petersalomonsen.vercel.app/api/openai",
            {
                method: 'POST',
                body: requestbody
            }).then(r => r.json());
        if (airesponse.error) {
            throw new Error(JSON.stringify(airesponse.error, null, 1));
        }
        return airesponse.choices[0].message.content;
    } catch (e) {
        console.log(e.message)
        window.parent.postMessage({ command: "error", error: e.message }, '*');
    }
}

window.onmessage = async (msg) => {
    globalThis.parentOrigin = msg.origin;

    console.log('iframe got message', msg.data);
    switch (msg.data.command) {
        case 'createaccount':
            const { secretKey, accountId } = await createAccount();
            window.parent.postMessage({ command: 'accountcreated', secretKey, accountId }, globalThis.parentOrigin);
            break;
        case 'useaccount':
            window.parent.postMessage({ command: 'usingaccount', accountId: await useAccount(msg.data.secretKey) }, globalThis.parentOrigin);
            break;
        case 'ask_ai':
            const response = await create_and_send_ask_ai_request([{ role: 'user', content: msg.data.aiquestion }], msg.data.model);            
            window.parent.postMessage({ command: 'airesponse', airesponse: response }, globalThis.parentOrigin);
            break;
    }
};

window.parent.postMessage({ command: 'ready' }, '*');
    </script>
</html>
`;

const { model, messages, setResponse } = props;

const SECRET_KEY_STORAGE_KEY = "secretKey";
Storage.privateGet(SECRET_KEY_STORAGE_KEY);

State.init({
  secretKey: null,
  airesponse: "",
  aiquestion: messages ?? "What is the meaning of life?",
  aimodel: model ?? "gpt-3.5-turbo",
  accountId: "",
  iframeMessage: null,
  usingAccount: false,
});

function init_iframe() {
  const secretKey = Storage.privateGet(SECRET_KEY_STORAGE_KEY);

  State.update({
    secretKey,
    iframeMessage: secretKey
      ? {
          command: "useaccount",
          secretKey: secretKey,
        }
      : {
          command: "createaccount",
        },
  });
}

function ask_ai() {
  State.update({
    iframeMessage: {
      command: "ask_ai",
      aiquestion: props.messages,
      model: state.aimodel,
      ts: new Date().getTime(),
    },
    progress: true,
  });
  console.log("state updated", state.iframeMessage);
}

function changeSecretKey(secretKey) {
  State.update({ secretKey });
  Storage.privateSet(SECRET_KEY_STORAGE_KEY, secretKey);
  init_iframe();
}

function handleMessage(msg) {
  switch (msg.command) {
    case "accountcreated":
      Storage.privateSet(SECRET_KEY_STORAGE_KEY, msg.secretKey);
      State.update({
        accountId: msg.accountId,
        secretKey: msg.secretKey,
      });
      break;
    case "airesponse":
      if (setResponse) {
        setResponse(msg.airesponse);
      }
      State.update({ airesponse: msg.airesponse, progress: false });
      break;
    case "usingaccount":
      State.update({ accountId: msg.accountId });
      break;
    case "error":
      console.log("error received in parent", msg.error);
      break;
    case "ready":
      console.log("ready");
      init_iframe();
      break;
  }
}

const iframe = (
  <iframe
    message={state.iframeMessage}
    onMessage={handleMessage}
    srcDoc={code}
    style={{ width: "0px", height: "0px", border: "none" }}
  ></iframe>
);

const secretKeyToggle = state.showSecretKey ? (
  <>
    <button onClick={() => State.update({ showSecretKey: false })}>Hide</button>
    <input
      type="text"
      value={state.secretKey}
      onChange={(e) => changeSecretKey(e.target.value)}
    ></input>
  </>
) : (
  <button onClick={() => State.update({ showSecretKey: true })}>Show</button>
);

return (
  <>
    {iframe}
    <textarea
      style={{ width: "100%" }}
      onChange={(e) => State.update({ aiquestion: e.target.value })}
      value={state.aiquestion}
    ></textarea>
    <select
      style={{ width: "100%" }}
      onChange={(e) => State.update({ aimodel: e.target.value })}
      value={state.aimodel}
    >
      {/* <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
      <option value="gpt-4">gpt-4</option> */}
      <option value="gpt-4-vision-preview">gpt-4-vision-preview</option>
    </select>
    {state.progress ? (
      <Progress.Root>
        <Progress.Indicator state="indeterminate" />
      </Progress.Root>
    ) : (
      <button onClick={ask_ai}>Ask ChatGPT</button>
    )}

    <div
      style={{ marginTop: "20px", padding: "20px", backgroundColor: "#f5f5f5" }}
    >
      <Markdown text={state.airesponse} />
    </div>

    <p>
      <br />
    </p>

    <p></p>
    <p>
      Spending account ID: <pre>{state.accountId}</pre>
      Copy account Id and fund from your own wallet (I recommend .5 N){" "}
      {/* How can we improve this? 
        Button to fund specific account from wallet?
        Keypom claim?
      */}
      <button
        className="classic"
        onClick={() => {
          clipboard.writeText(state.accountId);
        }}
      >
        <i className="bi bi-clipboard" />
      </button>
    </p>
    <p>Spending account secret key: {secretKeyToggle}</p>
  </>
);




function prepareMessages({ systemPrompt, dataUrl, instruction, comment, previousResponseContent }) {
  // dataUrl
  // instruction
  // comment

  const userMessages = [
    {
      type: "image_url",
      image_url: {
        // send an image of the current selection to gpt-4 so it can see what we're working with
        url: dataUrl,
        detail: "high",
      },
    },
    {
      type: "text",
      text: instruction, // comes from agent definition (instruction)
    },
    {
      // send the text of all selected shapes, so that GPT can use it as a reference (if anything is hard to see)
      type: "text",
      text: comment
    },
  ];


  // if the user has selected a previous response from gpt-4, include that too. hopefully gpt-4 will
  // modify it with any other feedback or annotations the user has left.
  if (previousResponseContent) {
    userMessages.push({
      type: "text",
      text: previousResponseContent,
    });
  }

  // combine the user prompt with the system prompt
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessages },
  ];
}


