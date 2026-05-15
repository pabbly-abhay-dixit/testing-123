const Card = ({ children, className = '', noPadding = false, onClick, ...rest }) => {
  return (
    <div onClick={onClick} className={`bg-white dark:bg-[#2c2c2c] rounded-2xl shadow-card border border-neutral-200 dark:border-[#484848] ${noPadding ? '' : 'p-6'} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export default Card
