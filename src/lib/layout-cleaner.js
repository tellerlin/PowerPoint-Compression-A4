// ... existing code ...

// Change Chinese logs to English
console.log('Remaining layout files after cleanup:', 
  memFS.findFiles(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/));

console.log('Layout references in content types:', 
  contentTypeOverrides.filter(override => override.PartName.includes('slideLayout')));

// ... existing code ...