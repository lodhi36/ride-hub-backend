const fs = require('fs');

const logPath = 'C:/Users/pc/.gemini/antigravity/brain/dccd05fa-1e2b-4a7e-aac9-1f2aef0b9de9/.system_generated/tasks/task-12253.log';
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');
const matched = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('1791975367296')) {
    // print surrounding lines
    const start = Math.max(0, i - 15);
    const end = Math.min(lines.length - 1, i + 35);
    matched.push(lines.slice(start, end).join('\n'));
    break;
  }
}
console.log(matched.join('\n---\n'));
