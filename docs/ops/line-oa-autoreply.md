# LINE OA auto-reply — guest support path (B16)

**Status:** ready to paste. **Owner action:** Winut. **Where:** LINE Official
Account Manager, per guest OA (HF and HF Ville), **Auto-response messages**.

## Why this exists

The in-chat bot is explicitly out of scope for the direct-booking programme,
so a guest who messages the OA gets **nothing** today. Meanwhile the LIFF
booking and payment screens all carry a call-the-desk line (B16, shipped),
and the OA is the one entry point that does not. A guest who taps the OA at
22:00 instead of the booking page must land on the same answer.

This file holds the exact text. It is not applied by code: LINE auto-replies
live in the console, and the only way they change is a person pasting them.

## Ground rules the copy follows

- **Thai first, English beneath.** Same order as every guest-facing line in
  the app; the desk answers in Thai.
- **24 hours, stated.** Reception answers around the clock (owner,
  2026-09-11). An unqualified "contact reception" on a message read at
  midnight is worse than nothing, because the guest assumes it is shut.
- **The desk number is the whole message.** No booking-status lookups, no
  "reply 1 for…", nothing that implies the OA can do something it cannot.
- **One number per OA.** Each property's OA carries only its own desk
  number; a guest sent to the wrong property at 02:00 is worse off than one
  who was given nothing.
- **No prices, no policy.** Deposit and refund terms are A13's page, not a
  chat reply that cannot be versioned.

## 1. Default auto-reply (both OAs)

Set as the response to **any** message, at **all** hours.

Replace `<DESK PHONE>` with that OA's property desk number — the same number
the app builds into `VITE_DESK_PHONE_HF` / `VITE_DESK_PHONE_HFVILLE`, so the
two cannot drift.

```
สวัสดีค่ะ ขอบคุณที่ติดต่อเรา

บัญชีนี้เป็นช่องทางรับข่าวสารและใช้จองห้องพักผ่านแอป ยังไม่มีเจ้าหน้าที่ตอบข้อความในแชทนี้

หากต้องการความช่วยเหลือเรื่องการจอง การชำระเงินมัดจำ หรือเรื่องเร่งด่วน
กรุณาติดต่อแผนกต้อนรับ โทร <DESK PHONE> (ตลอด 24 ชั่วโมง)

Hello, and thank you for contacting us.

This account is for updates and for booking through our app. Messages here
are not monitored by our staff.

For help with a booking, a deposit payment, or anything urgent, please
contact the front desk on <DESK PHONE> (open 24 hours).
```

## 2. Greeting message (sent once, on follow)

Shown to a guest the first time they add the OA. Keep it shorter than the
auto-reply: the point is the number, plus the fact that the booking flow
lives in the rich menu.

```
ยินดีต้อนรับสู่ <PROPERTY NAME> ค่ะ

จองห้องพักและดูสิทธิ์สมาชิกได้จากเมนูด้านล่าง
ต้องการความช่วยเหลือ กรุณาติดต่อแผนกต้อนรับ โทร <DESK PHONE> (ตลอด 24 ชั่วโมง)

Welcome to <PROPERTY NAME>.

Book a room and see your member benefits from the menu below.
Need help? Contact the front desk on <DESK PHONE> (open 24 hours).
```

`<PROPERTY NAME>`: `โรงแรม เดอะ ฮาร์เบอร์ ฟร้อนท์` / `The Harbour Front
Hotel` on the HF OA, `เอชเอฟ วิลล์` / `HF Ville` on the HF Ville OA.

## How to apply it

1. LINE Official Account Manager → pick the guest OA (not the staff HF ID
   bot; that one answers for itself).
2. **Chat settings → Response settings**: turn **Auto-response messages** on,
   leave chat (manual reply) off — nobody is watching the inbox.
3. **Auto-response messages** → new message → paste §1 with the number
   filled in → set it to apply at **all times, every day** → save.
4. **Greeting message** → paste §2 with the number and property name filled
   in → save.
5. Repeat for the second OA with **that property's** number.

## Verifying it

From a phone that is **not** an admin of the OA (an admin's own messages can
bypass the auto-reply):

1. Unfollow and re-follow the OA → the §2 greeting arrives.
2. Send any message (`ทดสอบ`) → the §1 reply arrives, within seconds.
3. Tap the number in the reply → the dialer opens on the right number.

If step 3 opens the dialer on the *other* property's number, the wrong OA was
edited — fix it before the rich menu ships (C1), because the menu is what
will drive traffic here.

## Related

- App-side desk line: `frontend/src/components/booking/DeskContactFooter.tsx`
  (booking form, hold/checkout, deposit and slip upload, booking status).
- Build-time numbers: `frontend/Dockerfile` takes `VITE_DESK_PHONE_HF` /
  `VITE_DESK_PHONE_HFVILLE` as build args and `ci-build-e2e.yml` fills them
  from the repository variables `DESK_PHONE_HF` / `DESK_PHONE_HFVILLE`
  (#414), so production already renders the numbers in the app. Changing one
  is a variable edit plus a rebuild; editing a running container's
  environment does nothing. **Use the same number here as in that
  variable** — a guest given two different numbers for one desk phones the
  wrong one.
- Rich menu with the Book tile: board item **C1**, blocked on the channel
  flip (B10).
