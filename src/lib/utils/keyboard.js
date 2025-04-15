export function setupKeyboardShortcuts(node, actions) {
  function handleKeydown(event) {
    // Ctrl+O: Open file
    if (event.ctrlKey && event.key === 'o' && actions.openFile) {
      event.preventDefault();
      actions.openFile();
    }
    
    // Ctrl+S: Save file
    if (event.ctrlKey && event.key === 's' && actions.saveFile) {
      event.preventDefault();
      actions.saveFile();
    }
    
    // Esc: Cancel operation
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