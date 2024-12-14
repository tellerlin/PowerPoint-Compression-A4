export function getLinkClasses(isActive) {
  return `px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
    isActive
      ? 'bg-primary-50 text-primary-700'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
  }`;
}