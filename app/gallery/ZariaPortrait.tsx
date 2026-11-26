'use client'
import Image from 'next/image'
import {useState} from 'react'
import { ZARIA_DISPLAY_PORTRAIT } from '@/lib/gallery/zaria'
export default function ZariaPortrait() {
 const [attempt,setAttempt]=useState(0)
 return <div className="relative aspect-[4/5] max-w-[19rem] overflow-hidden rounded-sm border border-primary/30 bg-background">
  {attempt >= 2 ? <p role="status" className="p-5 text-muted-foreground">Zaria’s portrait is temporarily unavailable.</p> :
   <Image alt="Zaria Solenne, Café Sativa Gallery curator" key={attempt} src={attempt === 0 ? ZARIA_DISPLAY_PORTRAIT : ZARIA_DISPLAY_PORTRAIT+'?retry=1'} fill unoptimized sizes="(max-width:768px) 90vw, 304px" className="object-contain" onError={()=>setAttempt(previous=>previous===attempt ? previous+1 : previous)}/>}
 </div>
}
