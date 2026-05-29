#!/usr/bin/env node
/** stdin: Revert markdown → stdout: positions JSON */
import { parseRevertAccountText } from "../js/revert-parse.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString("utf8");
process.stdout.write(JSON.stringify(parseRevertAccountText(text)));
