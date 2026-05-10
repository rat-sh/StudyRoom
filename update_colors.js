const fs = require('fs');
const path = require('path');

const walkSync = (dir, filelist = []) => {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else {
      if (dirFile.endsWith('.css') || dirFile.endsWith('.js') || dirFile.endsWith('.html')) {
        filelist.push(dirFile);
      }
    }
  });
  return filelist;
};

const files = walkSync('./public');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Replace colors
  if (content.includes('rgba(108,99,255')) {
    content = content.replace(/rgba\(108,99,255/g, 'rgba(0,184,148');
    changed = true;
  }
  if (content.includes('#6C63FF')) {
    content = content.replace(/#6C63FF/ig, '#00B894');
    changed = true;
  }
  if (content.includes('#5A52E0')) {
    content = content.replace(/#5A52E0/ig, '#008F72');
    changed = true;
  }
  
  // Remove :root hardcoded variables from feature css files
  if (file.includes('whiteboard.css') || file.includes('files.css') || file.includes('timer.css')) {
    if (content.includes(':root{')) {
      content = content.replace(/:root\{[^}]+\}/s, '');
      changed = true;
    }
  }

  // Also replace #1a1a24 in whiteboard.js to #FFFFFF for canvas bg
  if (file.includes('whiteboard.js')) {
    if (content.includes('#1a1a24')) {
      content = content.replace(/#1a1a24/g, '#FFFFFF');
      changed = true;
    }
  }

  // Replace #1a1a24 in whiteboard.css 
  if (file.includes('whiteboard.css')) {
    if (content.includes('#1a1a24')) {
      content = content.replace(/#1a1a24/g, '#FFFFFF');
      changed = true;
    }
  }

  // Include base.css in whiteboard/index.html
  if (file.includes('whiteboard/index.html')) {
    if (!content.includes('base.css')) {
      content = content.replace('<link rel="stylesheet" href="/features/whiteboard/whiteboard.css"/>', '<link rel="stylesheet" href="/core/css/base.css"/>\n<link rel="stylesheet" href="/features/whiteboard/whiteboard.css"/>');
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, content);
    console.log('Updated:', file);
  }
});
