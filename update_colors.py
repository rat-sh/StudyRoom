import os
import re

def walk_sync(dir_path):
    file_list = []
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.endswith('.css') or file.endswith('.js') or file.endswith('.html'):
                file_list.append(os.path.join(root, file))
    return file_list

files = walk_sync('./public')
for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    changed = False

    # Replace colors
    if 'rgba(108,99,255' in content:
        content = content.replace('rgba(108,99,255', 'rgba(0,184,148')
        changed = True
    
    if '#6C63FF' in content or '#6c63ff' in content:
        content = re.sub(r'(?i)#6C63FF', '#00B894', content)
        changed = True

    if '#5A52E0' in content or '#5a52e0' in content:
        content = re.sub(r'(?i)#5A52E0', '#008F72', content)
        changed = True

    # Remove :root hardcoded variables from feature css files
    if 'whiteboard.css' in file or 'files.css' in file or 'timer.css' in file:
        if ':root{' in content or ':root {' in content:
            content = re.sub(r':root\s*\{[^}]+\}', '', content)
            changed = True

    # Replace #1a1a24 in whiteboard files
    if 'whiteboard.js' in file or 'whiteboard.css' in file:
        if '#1a1a24' in content:
            content = content.replace('#1a1a24', '#FFFFFF')
            changed = True

    # Include base.css in whiteboard/index.html
    if 'whiteboard/index.html' in file:
        if 'base.css' not in content:
            content = content.replace('<link rel="stylesheet" href="/features/whiteboard/whiteboard.css"/>', '<link rel="stylesheet" href="/core/css/base.css"/>\n<link rel="stylesheet" href="/features/whiteboard/whiteboard.css"/>')
            changed = True

    if changed:
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print('Updated:', file)
