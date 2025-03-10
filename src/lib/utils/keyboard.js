export function setupKeyboardShortcuts(node, actions) {
  function handleKeydown(event) {
    // Ctrl+O: 打开文件
    if (event.ctrlKey && event.key === 'o' && actions.openFile) {
      event.preventDefault();
      actions.openFile();
    }
    
    // Ctrl+S: 保存文件
    if (event.ctrlKey && event.key === 's' && actions.saveFile) {
      event.preventDefault();
      actions.saveFile();
    }
    
    // Esc: 取消操作
    if (event.key === 'Escape' && actions.cancel) {
      event.preventDefault();
      actions.cancel();
    }
  }
  
  node.addEventListener('keydown', handleKeydown);
  
  return {
    destroy() {
      node.removeEventListener('keydown', handleKeydown);
    }
  };
}