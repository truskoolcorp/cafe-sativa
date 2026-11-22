const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('recovery link uses current origin and does not reveal account existence', () => {
 const request = fs.readFileSync('app/auth/reset/request.tsx','utf8')
 assert.match(request,/resetPasswordForEmail/)
 assert.match(request,/window\.location\.origin/)
 assert.match(request,/If an account exists/)
 assert.doesNotMatch(request,/service_role|STRIPE_SECRET_KEY/)
})
test('password changes require a session and confirmation', () => {
 const page=fs.readFileSync('app/auth/reset/confirm/page.tsx','utf8')
 assert.match(page,/exchangeCodeForSession/)
 assert.match(page,/auth\.getSession\(\)/)
 assert.match(page,/auth\.updateUser/)
 assert.match(page,/password !== confirm/)
})
test('sign-in exposes recovery entry point',()=>{
 assert.match(fs.readFileSync('app/auth/signin/page.tsx','utf8'),/href="\/auth\/reset"/)
})
