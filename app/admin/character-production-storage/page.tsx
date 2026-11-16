'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
export default function ProductionStorage(){const [result,setResult]=useState<unknown>(null),[busy,setBusy]=useState(false)
 async function inspect(create=false){setBusy(true);try{const r=await fetch('/api/admin/character-promotions/storage',{method:create?'POST':'GET',cache:'no-store'});setResult(await r.json())}catch{setResult({error:'Status unconfirmed; inspect before another attempt'})}finally{setBusy(false)}}
 useEffect(()=>{void inspect()},[])
 return <main className="max-w-3xl mx-auto px-5 pt-28"><Link href="/admin/character-promotions">Back to character promotions</Link><h1 className="text-3xl my-5">Private production storage</h1><p>Prepare two private buckets: output MP4 up to35MiB and audio up to8MiB. Does not enable generation, approve content, publish, or change existing bucket settings.</p><button disabled={busy} onClick={()=>void inspect(true)} className="border p-3 my-4">Prepare private production buckets</button><button disabled={busy} onClick={()=>void inspect()} className="border p-3 m-4">Inspect storage status</button><pre className="whitespace-pre-wrap">{JSON.stringify(result,null,2)}</pre></main>
}
