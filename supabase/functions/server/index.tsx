import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-0dcf88a1/health", (c) => {
  return c.json({ status: "ok" });
});

// Sign up endpoint - creates new user with RIT email verification
app.post("/make-server-0dcf88a1/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();

    // Validate RIT email
    if (!email.endsWith("@rit.edu")) {
      return c.json({ error: "Must use an @rit.edu email address" }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true
    });

    if (error) {
      console.log(`Sign up error: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    // Create user profile in KV store
    await kv.set(`user:${data.user.id}`, {
      id: data.user.id,
      email,
      name,
      subscriptionTier: 'free',
      createdAt: new Date().toISOString()
    });

    return c.json({ success: true, user: data.user });
  } catch (error) {
    console.log(`Sign up error: ${error}`);
    return c.json({ error: "Failed to create account" }, 500);
  }
});

// Get user profile
app.get("/make-server-0dcf88a1/profile", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const profile = await kv.get(`user:${user.id}`);
    return c.json({ profile });
  } catch (error) {
    console.log(`Profile fetch error: ${error}`);
    return c.json({ error: "Failed to fetch profile" }, 500);
  }
});

// Update subscription tier
app.post("/make-server-0dcf88a1/subscription", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { tier } = await c.req.json();
    const profile = await kv.get(`user:${user.id}`);
    
    if (profile) {
      profile.subscriptionTier = tier;
      await kv.set(`user:${user.id}`, profile);
    }

    return c.json({ success: true });
  } catch (error) {
    console.log(`Subscription update error: ${error}`);
    return c.json({ error: "Failed to update subscription" }, 500);
  }
});

// Create a new listing (housing or marketplace item)
app.post("/make-server-0dcf88a1/listings", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const listing = await c.req.json();
    const listingId = `listing:${crypto.randomUUID()}`;
    
    const newListing = {
      ...listing,
      id: listingId,
      userId: user.id,
      createdAt: new Date().toISOString(),
      status: 'active'
    };

    await kv.set(listingId, newListing);
    
    // Add to user's listings index
    const userListingsKey = `user-listings:${user.id}`;
    const userListings = await kv.get(userListingsKey) || [];
    userListings.push(listingId);
    await kv.set(userListingsKey, userListings);

    return c.json({ success: true, listing: newListing });
  } catch (error) {
    console.log(`Listing creation error: ${error}`);
    return c.json({ error: "Failed to create listing" }, 500);
  }
});

// Get all listings with optional filters
app.get("/make-server-0dcf88a1/listings", async (c) => {
  try {
    const type = c.req.query('type'); // 'housing' or 'marketplace'
    const category = c.req.query('category');
    
    const allListings = await kv.getByPrefix("listing:");
    
    let filteredListings = allListings.filter(listing => listing.status === 'active');
    
    if (type) {
      filteredListings = filteredListings.filter(listing => listing.type === type);
    }
    
    if (category) {
      filteredListings = filteredListings.filter(listing => listing.category === category);
    }

    // Sort by newest first
    filteredListings.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return c.json({ listings: filteredListings });
  } catch (error) {
    console.log(`Listings fetch error: ${error}`);
    return c.json({ error: "Failed to fetch listings" }, 500);
  }
});

// Get single listing
app.get("/make-server-0dcf88a1/listings/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const listing = await kv.get(`listing:${id}`);
    
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    return c.json({ listing });
  } catch (error) {
    console.log(`Listing fetch error: ${error}`);
    return c.json({ error: "Failed to fetch listing" }, 500);
  }
});

// Update listing
app.put("/make-server-0dcf88a1/listings/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param('id');
    const listingKey = `listing:${id}`;
    const listing = await kv.get(listingKey);
    
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    if (listing.userId !== user.id) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const updates = await c.req.json();
    const updatedListing = { ...listing, ...updates, updatedAt: new Date().toISOString() };
    await kv.set(listingKey, updatedListing);

    return c.json({ success: true, listing: updatedListing });
  } catch (error) {
    console.log(`Listing update error: ${error}`);
    return c.json({ error: "Failed to update listing" }, 500);
  }
});

// Delete listing
app.delete("/make-server-0dcf88a1/listings/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param('id');
    const listingKey = `listing:${id}`;
    const listing = await kv.get(listingKey);
    
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    if (listing.userId !== user.id) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Mark as deleted rather than actually deleting
    listing.status = 'deleted';
    await kv.set(listingKey, listing);

    return c.json({ success: true });
  } catch (error) {
    console.log(`Listing deletion error: ${error}`);
    return c.json({ error: "Failed to delete listing" }, 500);
  }
});

// Get user's listings
app.get("/make-server-0dcf88a1/my-listings", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const userListingsKey = `user-listings:${user.id}`;
    const listingIds = await kv.get(userListingsKey) || [];
    
    const listings = await kv.mget(listingIds);
    
    // Filter out deleted listings and sort by newest first
    const activeListings = listings
      .filter(listing => listing && listing.status !== 'deleted')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ listings: activeListings });
  } catch (error) {
    console.log(`User listings fetch error: ${error}`);
    return c.json({ error: "Failed to fetch user listings" }, 500);
  }
});

// Send message
app.post("/make-server-0dcf88a1/messages", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { recipientId, listingId, content } = await c.req.json();
    const messageId = `message:${crypto.randomUUID()}`;
    
    const message = {
      id: messageId,
      senderId: user.id,
      recipientId,
      listingId,
      content,
      createdAt: new Date().toISOString(),
      read: false
    };

    await kv.set(messageId, message);
    
    // Add to conversation index
    const conversationKey = `conversation:${[user.id, recipientId].sort().join(':')}:${listingId}`;
    const conversation = await kv.get(conversationKey) || [];
    conversation.push(messageId);
    await kv.set(conversationKey, conversation);

    return c.json({ success: true, message });
  } catch (error) {
    console.log(`Message send error: ${error}`);
    return c.json({ error: "Failed to send message" }, 500);
  }
});

// Get messages for a conversation
app.get("/make-server-0dcf88a1/messages/:listingId/:otherUserId", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (!user || error) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const listingId = c.req.param('listingId');
    const otherUserId = c.req.param('otherUserId');
    const conversationKey = `conversation:${[user.id, otherUserId].sort().join(':')}:${listingId}`;
    
    const messageIds = await kv.get(conversationKey) || [];
    const messages = await kv.mget(messageIds);
    
    // Sort by timestamp
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return c.json({ messages });
  } catch (error) {
    console.log(`Messages fetch error: ${error}`);
    return c.json({ error: "Failed to fetch messages" }, 500);
  }
});

Deno.serve(app.fetch);
