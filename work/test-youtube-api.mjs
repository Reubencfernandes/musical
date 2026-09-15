import {Client} from '../outputs/score-studio/node_modules/@gradio/client/dist/index.js';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const token=(await readFile(path.join(homedir(),'.cache/huggingface/token'),'utf8')).trim();
const client=await Client.connect('Reubencf/Score-Studio-API',{token});
try {
  const result=await client.predict('/youtube_import',['https://youtu.be/u10U7BHQQ2Y']);
  const [audio,metadata]=result.data;
  console.log(JSON.stringify({audio:!!audio,metadata:JSON.parse(metadata)}));
} finally {
  client.close();
}
