# 🧁 PROJECT REPORT

## Project Name: Smart Bakery Web Platform

## Developer: Prashant Pandey

---

# 🎯 PROJECT GOAL

Build a modern bakery website platform where:
shop name V3 cafe(have number whatsapp number, facebook, ig)
* Admin manages products (cakes, pastries, etc.)
* Users browse products easily
* Users order via WhatsApp
* System tracks customer interest (phone collection popup)
* Clean UI + scalable backend
* most be responsive for mobile highly focus for mobile others all for device ar needed fast ui loding image like system when not loding image placeholder is shown
---

# 🧠 CORE FEATURES

## 👤 USER SIDE

* View products (with categories)
* Filter: Available / Custom / Out of stock
* Product detail page (images, info)
* WhatsApp order system (pre-filled message)
* Auto popup after 1 minute → collect phone number
* Custom cake request form
* Search system (fast + simple)

---

## 🛠️ ADMIN PANEL

* Admin login (simple auth)
* other shoping e-commerce like price is 999 but you get in 560, how much percet off like system setup
* Add product
* home main image of any product, and easy to use simple like dashboard for both user and admin ui so, non educated peoples can understand about it, product details, product name and price description with percentages off now like
* Edit product
* Delete product
* Upload multiple images
* Set availability
* View customer phone numbers (leads tracking)
* Dashboard stats:

  * Total visitors
  * Interested users (entered phone)
  * Product views

---

# ⚙️ TECHNOLOGY STACK

## 🔙 Backend

* Python (Flask)
* SQLite (database)
* REST API

## 🔜 Frontend

* HTML (modular)
* CSS (split files)
* JavaScript (modular)

## 📦 Storage

* Images: /static/uploads/
* Data: SQLite DB

---

# 🧩 SYSTEM ARCHITECTURE

User → Frontend → API → Database
Admin → Dashboard → API → Database

WhatsApp Integration:
Frontend → Pre-filled link → WhatsApp

---

# 🔄 WORKFLOW

## USER FLOW

1. User visits website
2. Browses products
3. After 60 sec → popup asks phone
4. User clicks product
5. Click "Order"
6. Reads info → redirect to WhatsApp
7. Chat with owner

---

## ADMIN FLOW

1. Login
2. Add/Edit products
3. Monitor customer interest
4. Update availability

---

# 📁 PROJECT STRUCTURE

project/
│
├── backend/
│   ├── app.py
│   ├── database.py
│   ├── models.py
│   ├── routes/
│   │   ├── product_routes.py
│   │   ├── admin_routes.py
│   │   ├── analytics_routes.py
│
├── frontend/
│   ├── index.html
│   ├── product.html
│   ├── admin.html
│
│   ├── css/
│   │   ├── main.css
│   │   ├── product.css
│   │   ├── admin.css
│   │   ├── popup.css
│
│   ├── js/
│   │   ├── main.js
│   │   ├── product.js
│   │   ├── admin.js
│   │   ├── popup.js
│   │   ├── search.js
│
├── static/
│   ├── uploads/
│   ├── images/
│
├── database/
│   ├── db.sqlite3
│
└── README.md

---

# 🗄️ DATABASE DESIGN

## PRODUCTS TABLE

* id
* title
* description
* category
* price
* availability
* images

## USERS (LEADS)

* id
* phone
* timestamp

## ANALYTICS

* id
* page_views
* product_clicks

---

# 📲 WHATSAPP INTEGRATION

https://wa.me/977XXXXXXXXXX?text=Hello%20I%20want%20to%20order%20[PRODUCT_NAME]

Dynamic generation via JS.

---

# 💡 CUSTOMER TRACKING SYSTEM

## Popup Logic

* Trigger after 60 seconds
* Store phone in DB
* Prevent repeat popup (use localStorage)

---

# 🔍 SEARCH SYSTEM

* Live search using JS
* Filter by:

  * Name
  * Category
  * Availability

---

# 🎨 UI DESIGN PRINCIPLES

* Clean bakery theme
* Soft colors (cream, brown, pastel)
* Large product images
* Mobile-first design

---

# 🧠 ADVANCED FEATURES (OPTIONAL)

* AI product suggestion
* Trending products
* Order analytics
* Admin notifications

---

# 🔐 SECURITY

* Admin login session
* Input validation
* File upload restriction

---

# 🚀 DEPLOYMENT

Frontend:

* GitHub Pages / Netlify

Backend:

* Render / Railway

Database:

* SQLite (upgrade later)

---

# 📈 FUTURE UPGRADES

* Full cart system
* Online payments
* Delivery tracking
* Mobile app

---

# 🧠 FINAL SYSTEM IDEA

This is NOT just a website.

It is:
👉 Customer attraction system
👉 Lead generation system
👉 Sales conversion system

---

# 💥 RESULT

* Bakery gets more orders
* You build real-world project
* Scalable to multiple shops

---

# ✅ STATUS

✔ Fully buildable
✔ Beginner → Advanced scalable
✔ Perfect real-world startup project

---

# 🔥 END NOTE

Start simple → then upgrade.

Do NOT try to build everything in one day.

Build module by module:

1. Product display
2. WhatsApp order
3. Admin panel
4. Tracking system

---

END OF REPORT
