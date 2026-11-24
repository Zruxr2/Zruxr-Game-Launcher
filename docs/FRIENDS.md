# Setting up Friends (one time, 3 minutes)

Friends runs on the same Supabase project that already handles accounts. The app side is built in; the server needs one script.

1. Open your project at [supabase.com](https://supabase.com) and go to **SQL Editor**.
2. Press **New query**.
3. Open [`friends-setup.sql`](friends-setup.sql), copy everything, paste it into the query box.
4. Press **Run**. You should see "Success". It is safe to run again.
5. Then do the same with [`friends-setup-2.sql`](friends-setup-2.sql) (block list, invites, status, profile cards, compare games).
6. Open Zruxr, sign in, go to **Friends**.

If Friends still says it isn't switched on, wait a minute and reopen the page (Supabase takes a moment to notice new functions).

## How it works

- Everyone gets a profile with their username. People find each other only by typing an **exact username**; there is no list of users to browse.
- A friend request must be accepted. If two people ask each other, they become friends right away.
- Friends see your **current game, last game and total hours**. Turn that off in **Friends, Privacy, Show what I'm playing**. **Allow friend requests** stops new people adding you.
- While a game runs, Zruxr tells the server once a minute. If it stops hearing from you for 3 minutes, you show as not playing.

## Privacy and safety

- The tables have Row Level Security on with **no open policies**. The public key in the app cannot read them directly. Everything goes through functions that only return what the signed-in person may see.
- A person who turned requests off looks the same as a username that doesn't exist.
- Requests are limited to 20 per hour per person.
- **Block** removes the person and stops them finding or adding you (they just see "not found"). Unblock anytime from the Blocked list.
- Invites are limited to 15 per hour, and only go to accepted friends who haven't blocked you.
- **Invisible** makes you look offline and hides your current game. **Busy** is shown to friends and mutes your notifications.
- Profile cards and compare games share only game **names and hours** with accepted friends, and only while **Show what I'm playing** is on.
