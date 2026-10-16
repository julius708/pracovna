'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { usagePage } from './usage-page'
export default function UsageTracker(){
 const path=usePathname()
 useEffect(()=>{
  const page=usagePage(path || "")
  if(!page)return
  // Dedupe remounts (including StrictMode). Never send query strings, IDs or form values.
  const key='li-usage:'+path, now=Date.now()
  try { if(now-Number(sessionStorage.getItem(key)||0)<30000)return; sessionStorage.setItem(key,String(now)) } catch {}
  fetch('/api/usage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page}),keepalive:true}).catch(()=>{})
 },[path])
 return <p className="li-privacy">Pre zlepšovanie aplikácie evidujeme otvorené sekcie a čas použitia. Obsah súkromných rozhovorov sa v prehľade vedenia nezobrazuje.</p>
}
