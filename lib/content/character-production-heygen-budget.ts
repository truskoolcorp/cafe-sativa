/** Pure guard, not a wallet reader, reservation store, or authorization writer.
 * Inputs must originate in the trusted account/rate verifier; caller assertions
 * alone cannot authorize a provider request. SQL must independently reserve cost. */
export const cafeHeyGenPolicy=Object.freeze({monthlyCapCents:2000,timeZone:'America/Chicago',currency:'USD',
 authorizationReference:'Sentinel_3acee78ce7e48191abcd48706735bd28',
 accountId:'d61468fdf18c4b478f27857337ddd1ea',balanceKind:'api_wallet',autoTopUp:false,newSubscription:false})
const formatter=new Intl.DateTimeFormat('en-US',{timeZone:cafeHeyGenPolicy.timeZone,year:'numeric',month:'2-digit'})
export function cafeHeyGenPeriod(now:number):string{
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid budget time')
 const parts=formatter.formatToParts(new Date(now)),year=parts.find(p=>p.type==='year')?.value,month=parts.find(p=>p.type==='month')?.value
 if(!year||!/^\d{4}$/.test(year)||!month||!/^(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid budget period')
 return `${year}-${month}`
}
export type VerifiedApiWallet=Readonly<{accountId:string;balanceKind:'api_wallet';currency:'USD';balanceCents:number;autoTopUp:false;existingCreditOnly:true;verifiedAt:number;expiresAt:number;unreflectedReservationsCents:number}>
export type VerifiedVideoRate=Readonly<{accountId:string;provider:'heygen';model:'avatar_iv';mediaClass:'photo';centsPerMinute:number;verifiedAt:number;expiresAt:number}>
const integer=(x:number)=>Number.isSafeInteger(x)&&x>=0
function fresh(now:number,start:number,end:number,maxAge:number){return integer(start)&&integer(end)&&start<=now&&now<end&&end-start<=maxAge&&now-start<=maxAge}
export function conservativePhotoQuote(durationSeconds:number,centsPerMinute:number):number{
 if(!Number.isSafeInteger(durationSeconds)||durationSeconds<1||durationSeconds>180||!Number.isSafeInteger(centsPerMinute)||centsPerMinute<1||centsPerMinute>100000)throw Error('Invalid conservative quote')
 // Round UP to whole cents, never silently round a fractional charge down.
 return Number((BigInt(durationSeconds)*BigInt(centsPerMinute)+BigInt(59))/BigInt(60))
}
export function verifyCafeVideoBudget(input:{now:number;period:string;durationSeconds:number;quoteCents:number;reservedMonthCents:number;periodCapCents:number;wallet:VerifiedApiWallet;rate:VerifiedVideoRate}){
 try{
  const {now,wallet:w,rate:r}=input
  if(input.period!==cafeHeyGenPeriod(now)||input.periodCapCents!==2000||!integer(input.reservedMonthCents)||input.reservedMonthCents>2000)return false
  if(w.accountId!==cafeHeyGenPolicy.accountId||w.balanceKind!=='api_wallet'||w.currency!=='USD'||w.autoTopUp!==false||w.existingCreditOnly!==true||!integer(w.balanceCents)||!integer(w.unreflectedReservationsCents)||!fresh(now,w.verifiedAt,w.expiresAt,60000))return false
  if(r.accountId!==w.accountId||r.provider!=='heygen'||r.model!=='avatar_iv'||r.mediaClass!=='photo'||!fresh(now,r.verifiedAt,r.expiresAt,86400000))return false
  const minimum=conservativePhotoQuote(input.durationSeconds,r.centsPerMinute)
  return integer(input.quoteCents)&&input.quoteCents>=minimum&&input.quoteCents<=2000-input.reservedMonthCents&&input.quoteCents<=w.balanceCents-w.unreflectedReservationsCents
 }catch{return false}
}
/** Supply to the actual fixed-host transport's beforeWrite callback. Copies the
 * verified snapshot so asynchronous preparation cannot mutate/extend its TTL.
 * Atomic SQL reservation remains mandatory; this guard never creates authority. */
export function createCafeVideoPaidAdmission(input:Omit<Parameters<typeof verifyCafeVideoBudget>[0],'now'>,now:()=>number=Date.now){
 const snapshot=Object.freeze({...input,wallet:Object.freeze({...input.wallet}),rate:Object.freeze({...input.rate})})
 return ()=>{if(!verifyCafeVideoBudget({...snapshot,now:now()}))throw Error('Cafe video budget admission denied')}
}
