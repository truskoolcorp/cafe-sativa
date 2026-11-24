// Gallery Stripe preflight. No checkout, refund, account claim, or production credentials.
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {pinnedTools,parseAnonymousStripeOutput} from './gallery-house-sandbox-prep.mjs'

const check=(x)=>{if(!x)throw Error('check failed')}
const run=(cmd,args,env,opts={})=>execFileSync(cmd,args,{env,stdio:['ignore','pipe','pipe'],maxBuffer:64*1024,timeout:30000,...opts})
const path=process.env.PATH
const root=process.env.RUNNER_TEMP
let tmp, stage='runner isolation'
try {
 check(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='truskoolcorp/cafe-sativa')
 check(process.env.GITHUB_EVENT_NAME==='pull_request'&&process.env.GITHUB_HEAD_REF==='qa/gallery-house-stripe-preflight-20261124')
 check(process.env.GITHUB_RUN_ATTEMPT==='1'&&/^\/[A-Za-z0-9_./-]+$/.test(root??''))
 check(/^[a-f0-9]{40}$/.test(process.env.GALLERY_QA_EXACT_HEAD??''))
 check(run('git',['rev-parse','HEAD'],{PATH:path}).toString().trim()===process.env.GALLERY_QA_EXACT_HEAD)
 check(!Object.keys(process.env).some(k=>/^(STRIPE_|SUPABASE_|GALLERY_TEST_STRIPE_|VERCEL)/.test(k)))
 tmp=mkdtempSync(join(root,'gallery-stripe-preflight-'))
 const env={PATH:path,HOME:tmp,XDG_CONFIG_HOME:tmp,DO_NOT_TRACK:'1',STRIPE_CLI_TELEMETRY_OPTOUT:'1'}
 const archive=join(tmp,'cli.tar.gz')
 stage='pinned Stripe CLI download and digest'
 run('curl',['--disable','--silent','--show-error','--fail','--location','--proto','=https','--proto-redir','=https','--max-filesize','40000000','--max-time','25',pinnedTools.stripe.url,'-o',archive],env)
 check(createHash('sha256').update(readFileSync(archive)).digest('hex')===pinnedTools.stripe.sha256)
 run('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',tmp,'stripe'],env)
 console.log('PASS: verified the pinned Stripe CLI release.')
 stage='official unclaimed test sandbox creation'
 const raw=run(join(tmp,'stripe'),['sandbox','create','--email','you@example.com','--non-interactive'],env,{encoding:'utf8',timeout:120000})
 const c=parseAnonymousStripeOutput(raw)
 // An anonymous scratch account cannot be used as evidence about the merchant's Stripe account.
 check(c.account!=='acct_1GZMxgIDc7LlvDW9')
 console.log('PASS: Stripe issued an unclaimed restricted test sandbox credential.')
 stage='Stripe current-account authorization and house readiness'
 const response=await fetch('https://api.stripe.com/v1/account',{
  method:'GET',headers:{Authorization:'Bearer '+c.key},redirect:'error',signal:AbortSignal.timeout(15000),
 })
 console.log('Stripe current-account HTTP status: '+String(response.status))
 check(response.ok)
 const account=await response.json()
 check(account.id===c.account)
 console.log('PASS: provider account matches the unclaimed sandbox, not the merchant.')
 const ready=account.charges_enabled===true&&account.payouts_enabled===true
 console.log('House checkout account readiness: '+(ready?'PASS':'BLOCKED (charge/payout readiness not both enabled)'))
 check(ready)
 console.log('PASS: Sandbox preflight only. No Checkout Session, charge, transfer, refund, or real payment attempted.')
} catch {
 console.error('Gallery Stripe preflight stopped at: '+stage+'. Raw diagnostics suppressed.')
 process.exitCode=1
} finally {
 if(tmp)rmSync(tmp,{recursive:true,force:true})
}
