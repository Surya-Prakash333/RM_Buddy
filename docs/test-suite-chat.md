# RM Buddy Chat Test Suite
> Based on **remote MongoDB** data (m1b.dev.pr.com) — RM001 has **47 clients**
>
> Date: 2026-03-12

---

## Data Summary (RM001)

| Metric | Value |
|--------|-------|
| Total Clients | 47 |
| Total AUM | ~₹113.76 Cr |
| Revenue YTD | ₹1.37 Cr |
| Active Alerts | 3 (all pending) |
| Meetings Today | 2 |
| Leads | 5 (3 HOT, 1 WARM, 1 LOST) |
| Pipeline | Empty (₹0) |

**Tier Distribution:** BLACK: 12, PLATINUM: 14, GOLD: 10, SILVER: 8, DIAMOND: 3

**City Distribution:** Mumbai: 10, Bangalore: 9, Hyderabad: 9, Pune: 8, Chennai: 6, Delhi: 5

---

## Category 1: Greetings & Casual (Should NOT trigger specialist agents)

| # | Question | Expected Behavior |
|---|----------|-------------------|
| 1.1 | `Hi` | Warm greeting, introduces as Aria. No client data. No specialist dispatch. |
| 1.2 | `Hello` | Same as above |
| 1.3 | `Good morning` | Warm greeting, no data fetch |
| 1.4 | `Hey` | Warm greeting |
| 1.5 | `Thanks` | Acknowledgment, offers further help |
| 1.6 | `Bye` | Farewell message |
| 1.7 | `Namaste` | Warm greeting |

**What to verify in logs:** `[3/6 classify_intent] → GREETING (skipping specialists)` — no specialist dispatch.

---

## Category 2: Portfolio Overview

| # | Question | Expected Answer |
|---|----------|----------------|
| 2.1 | `How many clients do I have?` | **47 clients** |
| 2.2 | `What is my total AUM?` | **~₹113.76 Cr** |
| 2.3 | `Give me a summary of my portfolio` | 47 clients, ₹113.76 Cr AUM, tier breakdown (BLACK: 12, PLATINUM: 14, GOLD: 10, SILVER: 8, DIAMOND: 3) |
| 2.4 | `How many Diamond clients do I have?` | **3** — Priya Patel (₹1.65 Cr), Siddharth Jain (₹2.16 Cr), Vikram Sharma (₹3.18 Cr) |
| 2.5 | `How many Black tier clients do I have?` | **12** |
| 2.6 | `How many Platinum clients do I have?` | **14** |
| 2.7 | `How many Gold clients do I have?` | **10** |
| 2.8 | `How many Silver clients do I have?` | **8** |
| 2.9 | `What is my revenue this year?` | **₹1.37 Cr YTD** |

---

## Category 3: Client Search (by Name)

| # | Question | Expected Answer |
|---|----------|----------------|
| 3.1 | `Tell me about Kavya Sharma` | CL00001, BLACK tier, ₹2.84 Cr AUM, age 36, Bangalore, last interaction 26 days ago |
| 3.2 | `Who is Nikhil Bose?` | CL00002, BLACK tier, ₹4.43 Cr AUM, age 73, Chennai, last interaction 04 Jan 2026 |
| 3.3 | `Search for Rahul` | Should return multiple: Rahul Gupta (SILVER, ₹4.59 Cr), Rahul Das (BLACK, ₹3.01 Cr), Rahul Patel (GOLD, ₹3.50 Cr), Rahul Das (PLATINUM, ₹3.66 Cr), Rahul Patel (PLATINUM, ₹3.03 Cr) — up to 5 results |
| 3.4 | `Find client Kavya` | Multiple matches: Kavya Sharma (BLACK), Kavya Menon (GOLD), Kavya Verma (GOLD), Kavya Kapoor (PLATINUM), Kavya Pillai (PLATINUM) — note there's also Kavya Kapoor (SILVER) |
| 3.5 | `Do I have a client named Priya Patel?` | Yes — CL00021, DIAMOND tier, ₹1.65 Cr AUM, Mumbai, age 35 |
| 3.6 | `Tell me about Vikram Sharma` | Two matches: CL00034 (DIAMOND, ₹3.18 Cr, Pune, age 55) and CL00036 (SILVER, ₹1.89 Cr, Bangalore, age 62) |

### Edge Cases — Client Search

| # | Question | Expected Behavior |
|---|----------|-------------------|
| 3.7 | `Tell me about John Smith` | Should say client not found / no match |
| 3.8 | `Who is Buddy?` | Should say client not found (NOT search for "Buddy") |
| 3.9 | `Tell me about kavya sharma` (lowercase) | Should still find Kavya Sharma — case insensitive |
| 3.10 | `Client Rohit` | Multiple: Rohit Verma (SILVER, ₹1.91 Cr), Rohit Singh (GOLD, ₹4.77 Cr), Rohit Mehta (GOLD, ₹4.14 Cr), Rohit Mehta (GOLD, ₹97.18 L), Rohit Reddy (PLATINUM, ₹4.71 Cr) |

---

## Category 4: Tier-Based Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 4.1 | `List my Diamond clients` | Priya Patel (₹1.65 Cr, Mumbai), Siddharth Jain (₹2.16 Cr, Hyderabad), Vikram Sharma (₹3.18 Cr, Pune) |
| 4.2 | `Who are my top clients by AUM?` | Nisha Verma (₹4.93 Cr), Vikram Agarwal (₹4.87 Cr), Rohit Singh (₹4.77 Cr), Rohit Reddy (₹4.71 Cr), Rahul Gupta (₹4.59 Cr) |
| 4.3 | `Which clients have lowest AUM?` | Kavya Verma (₹6.29 L), Priya Kapoor (₹9.78 L), Kavya Menon (₹11.36 L), Arjun Singh (₹35.33 L), Karan Nair (₹55.06 L) |
| 4.4 | `Show me clients with AUM above 4 Cr` | Nisha Verma (₹4.93 Cr), Vikram Agarwal (₹4.87 Cr), Rohit Singh (₹4.77 Cr), Rohit Reddy (₹4.71 Cr), Rahul Gupta (₹4.59 Cr), Nikhil Bose (₹4.43 Cr), Siddharth Reddy (₹4.22 Cr), Rohit Mehta (₹4.14 Cr), Siddharth Verma (₹4.14 Cr) |

---

## Category 5: Alert Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 5.1 | `Do I have any alerts?` | Yes, **3 pending alerts** |
| 5.2 | `Show my alerts` | AL00001: Cash surplus (HIGH, CL00097, Feb 25), AL00006: Cash surplus (HIGH, CL00026, Feb 17), AL00005: Anniversary (HIGH, CL00049, Feb 15) |
| 5.3 | `Any pending alerts?` | All 3 are pending |
| 5.4 | `What needs my attention?` | 3 pending alerts (2 cash surplus, 1 anniversary) — all HIGH severity |

**Note:** Alert client IDs (CL00097, CL00049) are outside RM001's 47-client range (CL00001-CL00047), so client_name shows "Unknown". CL00026 = Priya Menon.

---

## Category 6: Meeting Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 6.1 | `Do I have any meetings today?` | Yes, **2 meetings** |
| 6.2 | `What's my schedule today?` | MT00003: Arjun Menon at 11:09 — KYC Update (Nuvama Office, 60 min); MT00001: Siddharth Bose at 11:09 — Product Pitch (Nuvama Office, 60 min) |
| 6.3 | `Any meetings with Siddharth Bose?` | Yes — Product Pitch meeting at 11:09 at Nuvama Office |

---

## Category 7: Lead Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 7.1 | `Show me my leads` | 5 leads: Deepa Verma (HOT, ₹1.02 Cr), Siddharth Singh (LOST, ₹17.40 L), Rohit Bose (HOT, ₹62.86 L), Rohit Pillai (HOT, ₹1.05 Cr), Priya Sharma (WARM, ₹77.37 L) |
| 7.2 | `How many hot leads do I have?` | **3 HOT leads** — Deepa Verma (₹1.02 Cr, digital), Rohit Bose (₹62.86 L, cold call), Rohit Pillai (₹1.05 Cr, cold call) |
| 7.3 | `Any warm leads?` | 1 — Priya Sharma (₹77.37 L, digital, last contact Sep 2025) |

---

## Category 8: City/Geography Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 8.1 | `How many clients do I have in Mumbai?` | **10 clients** |
| 8.2 | `List my Bangalore clients` | **9 clients**: Kavya Sharma, Nisha Kapoor, Rohit Singh, Siddharth Singh, Rahul Das, Priya Menon, Nikhil Reddy, Vikram Sharma, Siddharth Reddy |
| 8.3 | `Which city has the most clients?` | Mumbai (10), followed by Bangalore (9), Hyderabad (9) |
| 8.4 | `Show my Delhi clients` | **5**: Deepa Das, Priya Kapoor, Vikram Agarwal, Kavya Kapoor, Deepa Bose |
| 8.5 | `Do I have any clients in Kolkata?` | No clients in Kolkata |

---

## Category 9: Engagement / Dormancy

| # | Question | Expected Answer |
|---|----------|----------------|
| 9.1 | `Which clients haven't I contacted recently?` | Look for "inactive" or "dormant" clients — clients with last_interaction oldest dates: Nisha Kapoor (18 Dec 2025), Karan Reddy (29 Dec 2025), Kavya Verma (30 Dec 2025), Rohit Verma (02 Jan 2026), Nikhil Bose (04 Jan 2026) |
| 9.2 | `Show me dormant clients` | Clients not contacted in 60+ days (from Mar 12, 2026): many clients from Dec 2025 and Jan 2026 qualify |
| 9.3 | `When did I last speak to Kavya Sharma?` | 26 days ago (from today) |

---

## Category 10: Complex / Multi-Intent Queries

| # | Question | Expected Answer |
|---|----------|----------------|
| 10.1 | `Give me a morning briefing` | Should combine: 47 clients, ₹113.76 Cr AUM, 3 pending alerts, 2 meetings today, top hot leads |
| 10.2 | `What should I focus on today?` | 2 meetings (Arjun Menon — KYC Update, Siddharth Bose — Product Pitch), 3 pending alerts, 3 hot leads to follow up |
| 10.3 | `How is my portfolio performing?` | ₹113.76 Cr AUM, ₹1.37 Cr revenue YTD, 0% MoM AUM change, 0% MoM revenue change |

---

## Category 11: Edge Cases & Negative Tests

| # | Question | Expected Behavior |
|---|----------|-------------------|
| 11.1 | `What's the weather today?` | Should politely redirect — "I can help with wealth management queries" |
| 11.2 | `Tell me a joke` | Should politely redirect or provide a brief response then offer help |
| 11.3 | `Delete all my client data` | Should be blocked by guardrails or refuse |
| 11.4 | (empty message) | Should handle gracefully |
| 11.5 | `asdfjkl;` | Should handle gracefully — "I didn't understand, could you rephrase?" |
| 11.6 | `Show me client CL00050 details` | Client ID outside RM001's range — should say not found |

---

## Category 12: Duplicate Name Edge Cases

| # | Question | Expected Answer |
|---|----------|----------------|
| 12.1 | `Tell me about Rahul Patel` | **Two matches**: CL00014 (GOLD, ₹3.50 Cr, Pune, age 35) AND CL00030 (PLATINUM, ₹3.03 Cr, Mumbai, age 46) |
| 12.2 | `Who is Rohit Mehta?` | **Two matches**: CL00025 (GOLD, ₹4.14 Cr, Chennai, age 39) AND CL00029 (GOLD, ₹97.18 L, Mumbai, age 49) |
| 12.3 | `Find Rahul Das` | **Two matches**: CL00012 (BLACK, ₹3.01 Cr, Bangalore, age 47) AND CL00038 (PLATINUM, ₹3.66 Cr, Pune, age 54) |
| 12.4 | `Tell me about Kavya Kapoor` | **Two matches**: CL00008 (PLATINUM, ₹3.72 Cr, Mumbai, age 73) AND CL00031 (SILVER, ₹2.59 Cr, Delhi, age 48) |
| 12.5 | `Who is Siddharth Reddy?` | **Two matches**: CL00016 (SILVER, ₹4.22 Cr, Mumbai, age 44) AND CL00047 (SILVER, ₹1.77 Cr, Bangalore, age 72) |

---

## Quick Reference: All 47 Clients

| ID | Name | Tier | AUM | City | Age |
|----|------|------|-----|------|-----|
| CL00001 | Kavya Sharma | BLACK | ₹2.84 Cr | Bangalore | 36 |
| CL00002 | Nikhil Bose | BLACK | ₹4.43 Cr | Chennai | 73 |
| CL00003 | Nisha Kapoor | SILVER | ₹76.82 L | Bangalore | 33 |
| CL00004 | Kavya Menon | GOLD | ₹11.36 L | Mumbai | 44 |
| CL00005 | Karan Jain | PLATINUM | ₹2.01 Cr | Pune | 71 |
| CL00006 | Kavya Verma | GOLD | ₹6.29 L | Chennai | 70 |
| CL00007 | Siddharth Bose | PLATINUM | ₹1.25 Cr | Hyderabad | 48 |
| CL00008 | Kavya Kapoor | PLATINUM | ₹3.72 Cr | Mumbai | 73 |
| CL00009 | Karan Reddy | BLACK | ₹1.43 Cr | Mumbai | 39 |
| CL00010 | Rahul Gupta | SILVER | ₹4.59 Cr | Pune | 69 |
| CL00011 | Rohit Verma | SILVER | ₹1.91 Cr | Hyderabad | 28 |
| CL00012 | Rahul Das | BLACK | ₹3.01 Cr | Bangalore | 47 |
| CL00013 | Kavya Pillai | PLATINUM | ₹73.91 L | Pune | 35 |
| CL00014 | Rahul Patel | GOLD | ₹3.50 Cr | Pune | 35 |
| CL00015 | Deepa Das | BLACK | ₹81.72 L | Delhi | 34 |
| CL00016 | Siddharth Reddy | SILVER | ₹4.22 Cr | Mumbai | 44 |
| CL00017 | Priya Jain | BLACK | ₹55.41 L | Hyderabad | 64 |
| CL00018 | Meera Reddy | BLACK | ₹2.42 Cr | Pune | 50 |
| CL00019 | Nisha Gupta | PLATINUM | ₹3.20 Cr | Pune | 59 |
| CL00020 | Siddharth Singh | BLACK | ₹2.03 Cr | Bangalore | 41 |
| CL00021 | Priya Patel | DIAMOND | ₹1.65 Cr | Mumbai | 35 |
| CL00022 | Aditya Reddy | PLATINUM | ₹3.69 Cr | Chennai | 42 |
| CL00023 | Pooja Singh | SILVER | ₹3.08 Cr | Mumbai | 50 |
| CL00024 | Rohit Reddy | PLATINUM | ₹4.71 Cr | Hyderabad | 74 |
| CL00025 | Rohit Mehta | GOLD | ₹4.14 Cr | Chennai | 39 |
| CL00026 | Priya Menon | PLATINUM | ₹3.23 Cr | Bangalore | 73 |
| CL00027 | Siddharth Jain | DIAMOND | ₹2.16 Cr | Hyderabad | 58 |
| CL00028 | Siddharth Verma | GOLD | ₹4.14 Cr | Chennai | 57 |
| CL00029 | Rohit Mehta | GOLD | ₹97.18 L | Mumbai | 49 |
| CL00030 | Rahul Patel | PLATINUM | ₹3.03 Cr | Mumbai | 46 |
| CL00031 | Kavya Kapoor | SILVER | ₹2.59 Cr | Delhi | 48 |
| CL00032 | Rohit Singh | GOLD | ₹4.77 Cr | Bangalore | 32 |
| CL00033 | Karan Nair | BLACK | ₹55.06 L | Chennai | 32 |
| CL00034 | Vikram Sharma | DIAMOND | ₹3.18 Cr | Pune | 55 |
| CL00035 | Nisha Verma | PLATINUM | ₹4.93 Cr | Hyderabad | 62 |
| CL00036 | Vikram Sharma | SILVER | ₹1.89 Cr | Bangalore | 62 |
| CL00037 | Deepa Menon | BLACK | ₹2.38 Cr | Mumbai | 51 |
| CL00038 | Rahul Das | PLATINUM | ₹3.66 Cr | Pune | 54 |
| CL00039 | Priya Kapoor | BLACK | ₹9.78 L | Delhi | 51 |
| CL00040 | Arjun Nair | PLATINUM | ₹77.39 L | Hyderabad | 33 |
| CL00041 | Arjun Singh | BLACK | ₹35.33 L | Hyderabad | 65 |
| CL00042 | Nikhil Reddy | PLATINUM | ₹3.24 Cr | Bangalore | 42 |
| CL00043 | Vikram Agarwal | GOLD | ₹4.87 Cr | Delhi | 33 |
| CL00044 | Priya Agarwal | GOLD | ₹1.61 Cr | Hyderabad | 53 |
| CL00045 | Meera Patel | PLATINUM | ₹1.42 Cr | Mumbai | 47 |
| CL00046 | Deepa Bose | GOLD | ₹2.35 Cr | Delhi | 75 |
| CL00047 | Siddharth Reddy | SILVER | ₹1.77 Cr | Bangalore | 72 |
