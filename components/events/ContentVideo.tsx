'use client'
export function ContentVideo({src,allowDownload}:{src:string;allowDownload:boolean}) {
 return <div><video src={src} controls controlsList={allowDownload?undefined:'nodownload'} disablePictureInPicture={!allowDownload} onContextMenu={allowDownload?undefined:e=>e.preventDefault()} preload="metadata" aria-label="Approved virtual Café Sativa concept preview" className="w-full max-h-[480px] rounded-lg mb-4"/>{allowDownload && <a className="inline-flex rounded-lg border border-primary px-4 py-3 mb-4" href={`${src}?download=1`}>Download approved video ↓</a>}</div>
}
