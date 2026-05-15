import { useState, useRef, useCallback } from 'react';

// Ported from ptm-app's UserAvatar — initials gradient fallback + retry on
// transient image errors. PPM's UserHoverCard dependency is dropped here
// (pc-agentic-ai has no equivalent yet).
const MAX_RETRIES = 2;

const UserAvatar = ({ user, size = 'md', className = '' }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const retryCount = useRef(0);
  const [retrySuffix, setRetrySuffix] = useState('');

  const sizeClasses = {
    xs: 'w-5 h-5 text-[8px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-9 h-9 text-sm',
    lg: 'w-10 h-10 text-sm',
    xl: 'w-24 h-24 text-3xl',
  };

  const sizeClass = sizeClasses[size] || sizeClasses.md;
  const name = user?.name || user?.email || '';
  const avatar = user?.avatar || user?.avatar_url || '';
  const initial = (name.charAt(0) || '?').toUpperCase();

  const handleLoad = useCallback(() => setImageLoaded(true), []);
  const handleError = useCallback(() => {
    if (retryCount.current < MAX_RETRIES) {
      retryCount.current += 1;
      setTimeout(() => setRetrySuffix(`r=${retryCount.current}`), 1500 * retryCount.current);
    } else {
      setGaveUp(true);
    }
  }, []);

  if (!avatar || gaveUp) {
    return (
      <div className={`${sizeClass} rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 flex items-center justify-center text-white font-medium ${className}`}>
        {initial}
      </div>
    );
  }

  const src = retrySuffix ? `${avatar}${avatar.includes('?') ? '&' : '?'}${retrySuffix}` : avatar;

  return (
    <div className={`${sizeClass} rounded-full relative ${className}`}>
      {!imageLoaded && (
        <div className={`${sizeClass} rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 flex items-center justify-center text-white font-medium absolute inset-0`}>
          {initial}
        </div>
      )}
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover relative ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
};

export default UserAvatar;
