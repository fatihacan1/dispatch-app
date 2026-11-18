const readline = require('node:readline');
const { execFile } = require('node:child_process');
const name = process.argv[2], bin = process.argv[3];
const run = (args, done = () => {}) => execFile(bin, args, { env: process.env }, (error, stdout, stderr) => { if (error) console.log(`[tool error] ${stderr || error.message}`); if (stdout) console.log(stdout.trim()); done(); });
const rl = readline.createInterface({ input: process.stdin });
const prompt = () => process.stdout.write('> ');
let waiting = process.env.DISPATCH_DEMO_ATTENTION === '1' ? (name === 'boss' ? 'trust' : name === 'coder' ? 'approval' : 'signin') : '';
// 'trust-late': the boss asks to trust the folder at once, the coder only 4 s later (a subagent that comes up afterwards).
const trustLate = process.env.DISPATCH_DEMO_ATTENTION === 'trust-late' && name === 'coder';
if (process.env.DISPATCH_DEMO_ATTENTION === 'trust-late' && name === 'boss') waiting = 'trust';
if (trustLate) setTimeout(() => { waiting = 'trust'; console.log('Do you trust this folder? Yes, I trust this folder'); }, 4000);
if (waiting === 'trust') console.log('Do you trust this folder? Yes, I trust this folder');
else if (waiting === 'approval') console.log('Approve this command? Yes / No');
else if (waiting === 'signin') console.log('Sign in to continue');
else { console.log(`DISPATCH / DEMO AGENT: ${name}\nWorkspace connected. Ready for orders.`); prompt(); }
setInterval(() => { if (!waiting) { console.log('\nChecking workspace status'); prompt(); } }, 5000);
rl.on('line', line => {
 if (waiting) { waiting = ''; console.log('Ready for orders.'); prompt(); return; }
 console.log(`\n[${name}] Received: ${line}`);
 const match = /^\[Dispatch\] message from (\S+) \(id ([^)]+)\): ([\s\S]*)$/.exec(line);
 if (!match) { prompt(); return; }
 const [, from, id, text] = match;
 if (name === 'boss' && from !== 'you' && from !== 'user') prompt();
 else if (name === 'boss' && /create template/i.test(text)) run(['template','create','--name','demo-specialist','--provider','codex','--description','Demo specialist','--role','Complete assigned work and report back.'], () => run(['spawn','--template','demo-specialist','--name','specialist-1','--task',text], prompt));
 else if (name === 'boss' && /spawn|enlist|build.*team/i.test(text)) run(['spawn','--template','coder','--name','coder-1','--task',text], prompt);
 else if (name === 'boss' && /ask scout/i.test(text)) run(['ask','--to','scout',text,'--wait'], prompt);
 else if (name === 'boss' && /coder/i.test(text)) run(['send','--to','coder',text], prompt);
 else if (from !== 'you' && from !== 'user') run(['reply','--to',from,'--re',id,`Done: ${text}`], prompt);
 else run(['send','--to',from,`Received: ${text}`], prompt);
});
