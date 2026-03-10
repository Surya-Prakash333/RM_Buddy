// MongoDB text indexes for Q&A search
db = db.getSiblingDB('rmbuddy');

// clients — search by name, PAN, email, phone
db.clients.createIndex(
  { client_name: "text", email: "text", pan: "text" },
  { name: "clients_text_search", weights: { client_name: 10, email: 3, pan: 1 } }
);

// portfolios — search by instrument names
db.portfolios.createIndex(
  { "holdings.instrument_name": "text", "holdings.isin": "text" },
  { name: "portfolios_text_search" }
);

// alerts — search alert content
db.alerts.createIndex(
  { title: "text", message: "text", client_name: "text" },
  { name: "alerts_text_search" }
);

// rm_interactions — search interaction notes
db.rm_interactions.createIndex(
  { notes: "text", client_name: "text" },
  { name: "rm_interactions_text_search" }
);

// meetings — search meeting notes/client names
db.meetings.createIndex(
  { notes: "text", client_name: "text", agenda: "text" },
  { name: "meetings_text_search" }
);

print('✅ Text indexes created on clients, portfolios, alerts, rm_interactions, meetings');
