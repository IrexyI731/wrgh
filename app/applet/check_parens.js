const fs = require('fs');
const content = fs.readFileSync('/app/applet/src/App.tsx', 'utf8');
let stack = [];
let lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  for (let j = 0; j < line.length; j++) {
    let char = line[j];
    if (char === '(') stack.push({ char, line: i + 1, col: j + 1 });
    else if (char === ')') {
      if (stack.length === 0) console.log(`Extra ) at ${i + 1}:${j + 1}`);
      else stack.pop();
    }
  }
}
if (stack.length > 0) {
  console.log(`Unclosed ( :`);
  stack.forEach(s => console.log(`${s.line}:${s.col}`));
}
