'use client'
import Image from 'next/image'
import {useState} from 'react'
import { ZARIA_DISPLAY_PORTRAIT } from '@/lib/gallery/zaria'
export default function ZariaPortrait() {
 const [failed,setFailed]=useState(false)
 return <div className="relative aspect-[4/5] max-w-[19rem] overflow-hidden rounded-sm border border-primary/30 bg-background">
  {failed ? <p role="status" className="p-5 text-muted-foreground">Zaria’s portrait is temporarily unavailable.</p> :
   <Image alt="Zaria Solenne, Café Sativa Gallery curator" src={ZARIA_DISPLAY_PORTRAIT} fill unoptimized sizes="(max-width:768px) 90vw, 304px" className="object-contain" onError={()=>setFailed(true)}/>}
 </div>
}
