Green Cart — Grocery Store Agent

A web chat counter for a grocery store. Staff type orders in plain English. The agent logs the sale, updates stock, and answers questions about prices, inventory, and sales.

What it does





Chat: place orders, ask prices, check stock, restock, or request a sales summary



Inventory: live stock, prices, stock value, and low-stock alerts



Sales: today's revenue, order history, top products, CSV export, and remove-sale (stock is restored)

Example chat:

2 kg rice, 1 dozen eggs, 3 liters milk
How much is chicken?
Do you have tomatoes?
What are today's sales?
Restock 20 kg flour
Show products

Requirements





Node.js 18 or later



npm

Quick start

# Install dependencies
npm install

# Start API (port 3001) and Vite (port 5173)
npm run dev

Open http://localhost:5173

The Vite dev server proxies /api to the backend, so chat and dashboards work from one URL.

Production

# Build the frontend
npm run build

# Serve the built app and API on port 3001
npm start

Then open http://localhost:3001

Keep the process running with PM2, systemd, or a host such as Railway or Render. Point a domain at that server if the store will use it every day.

Project layout

index.html              Chat, inventory, and sales UI
src/app.js              Frontend logic
src/style.css           Styles
server/index.js         Express API
server/parser.js        Order / intent parser
server/catalog.js       Product list, prices, starting stock
server/data/store.json  Saved inventory and sales
vite.config.js          Dev server, proxy, allowed hosts

Catalog

Starting items live in server/catalog.js. Edit that file to change names, prices, units, aliases, or opening stock.

Categories: Grains, Staples, Dairy, Bakery, Beverages, Produce, Meat, Household.

Low-stock threshold is 10 units (LOW_STOCK_THRESHOLD).

Data

Sales and stock are stored in server/data/store.json.





Do not delete this file on a live store, or history and stock will reset



Removing a sale from the Sales tab puts those quantities back into inventory



First run creates the file from the catalog if it is missing

API







Method



Path



Purpose





GET



/api/health



Health check





GET



/api/store



Inventory, sales, and summaries





POST



/api/chat



{ "message": "..." } — chat agent





POST



/api/orders



Place an order from structured items





POST



/api/restock



{ "sku": "rice", "qty": 20 }





DELETE



/api/sales/:id



Remove a sale and restore stock

Scripts







Command



Description





npm run dev



Frontend + API for local use





npm run build



Vite production build into dist/





npm start



Production server on port 3001

Notes for a live store





Run this on a shop PC or VPS that stays on.



Back up server/data/store.json.



Update server/catalog.js when prices or products change, then restart.



A MonkeyCode preview link only lasts for that session. It is not a permanent store URL.

