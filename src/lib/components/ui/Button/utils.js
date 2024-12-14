export function getButtonClasses(variant, disabled) {
  const baseClasses = [
    'inline-flex',
    'items-center',
    'justify-center',
    'px-6',
    'py-3',
    'border',
    'rounded-lg',
    'text-base',
    'font-medium',
    'shadow-sm',
    'transition-all',
    'duration-200',
    'focus:outline-none',
    'focus:ring-2',
    'focus:ring-offset-2'
  ];

  const variantClasses = variant === 'primary'
    ? [
        'bg-primary-600',
        'text-white',
        'hover:bg-primary-700',
        'focus:ring-primary-500',
        'border-transparent'
      ]
    : [
        'bg-white',
        'text-gray-700',
        'hover:bg-gray-50',
        'focus:ring-gray-500',
        'border-gray-300'
      ];

  const disabledClasses = disabled ? ['opacity-50', 'cursor-not-allowed'] : [];

  return [...baseClasses, ...variantClasses, ...disabledClasses].join(' ');
}