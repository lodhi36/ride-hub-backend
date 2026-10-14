const fs = require('fs');

const logPath = 'C:/Users/pc/.gemini/antigravity/brain/dccd05fa-1e2b-4a7e-aac9-1f2aef0b9de9/.system_generated/tasks/task-12253.log';
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');
const matched = lines.filter(l => l.includes('role=rider') || l.includes('targetRiderId') || l.includes('Authorized role: "rider"'));
console.log(`Matched ${matched.length} rider queries:`);
console.log(matched.slice(-15).join('\n'));
