const fs = require('fs');

const logPath = 'C:/Users/pc/.gemini/antigravity/brain/dccd05fa-1e2b-4a7e-aac9-1f2aef0b9de9/.system_generated/tasks/task-12253.log';
if (fs.existsSync(logPath)) {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  const matched = lines.filter(l => l.includes('1791975367296') || l.includes('dispatch') || l.includes('RIDER_SEARCH'));
  console.log(`Matched ${matched.length} lines:`);
  console.log(matched.slice(-30).join('\n'));
} else {
  console.log('Log file not found');
}
