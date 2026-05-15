import CopyBtn from './CopyBtn'

export default function Code({ children }) {
  const text = typeof children === 'string' ? children : (Array.isArray(children) ? children.join('') : String(children || ''))
  return (
    <div className="relative group my-2.5 rounded-lg overflow-hidden border border-gray-200 dark:border-neutral-700">
      <pre className="px-4 py-3 pr-10 bg-gray-50 dark:bg-neutral-900 text-[12px] font-mono text-gray-800 dark:text-neutral-200 overflow-x-auto whitespace-pre-wrap leading-[1.7]">{children}</pre>
      <div className="absolute top-2 right-2 opacity-60 group-hover:opacity-100 transition-opacity">
        <CopyBtn text={text} />
      </div>
    </div>
  )
}
