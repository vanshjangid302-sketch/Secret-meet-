
// Secret Meet — app.js
// Supabase login, signup, profile, matching, chat & admin

const SUPABASE_URL = "https://jcgkforrpinbwvosjvwb.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ---------- HELPERS ----------
const $ = (id) => document.getElementById(id);
const currentUser = () => db.auth.getUser();

async function getUser() {
  const { data } = await db.auth.getUser();
  return data?.user || null;
}

function showMessage(message) {
  alert(message);
}

// ---------- SIGNUP ----------
async function signup(email, password, name) {
  const { data, error } = await db.auth.signUp({
    email,
    password
  });

  if (error) return showMessage(error.message);

  if (data.user) {
    const { error: profileError } = await db
      .from("profiles")
      .upsert({
        id: data.user.id,
        name: name,
        status: "active"
      });

    if (profileError) {
      showMessage(profileError.message);
      return;
    }
  }

  showMessage("Signup successful! Please login.");
}

// ---------- LOGIN ----------
async function login(email, password) {
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) return showMessage(error.message);

  showMessage("Login successful!");
  location.reload();
}

// ---------- LOGOUT ----------
async function logout() {
  const { error } = await db.auth.signOut();
  if (error) return showMessage(error.message);
  location.reload();
}

// ---------- CURRENT PROFILE ----------
async function loadProfile() {
  const user = await getUser();
  if (!user) return null;

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

// ---------- UPDATE PROFILE ----------
async function updateProfile(fields) {
  const user = await getUser();
  if (!user) return showMessage("Please login first.");

  const { error } = await db
    .from("profiles")
    .update(fields)
    .eq("id", user.id);

  if (error) return showMessage(error.message);
  showMessage("Profile updated!");
}

// ---------- FIND MATCHES ----------
async function findMatches() {
  const user = await getUser();
  if (!user) return showMessage("Please login first.");

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .neq("id", user.id)
    .eq("status", "active");

  if (error) {
    console.error(error);
    showMessage("Unable to load matches.");
    return [];
  }

  return data || [];
}

// ---------- LIKE USER ----------
async function likeUser(targetId) {
  const user = await getUser();
  if (!user) return showMessage("Please login first.");
  if (targetId === user.id) return;

  const { error } = await db.from("likes").insert({
    user_id: user.id,
    liked_user_id: targetId
  });

  if (error && error.code !== "23505") {
    showMessage(error.message);
    return;
  }

  const { data: mutual } = await db
    .from("likes")
    .select("*")
    .eq("user_id", targetId)
    .eq("liked_user_id", user.id)
    .maybeSingle();

  if (mutual) {
    showMessage("It's a match! ❤️");
  } else {
    showMessage("Like sent!");
  }
}

// ---------- LOAD MATCHES ----------
async function loadMatches() {
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await db
    .from("matches")
    .select("*")
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);

  if (error) {
    console.error(error);
    return [];
  }

  return data || [];
}

// ---------- SEND MESSAGE ----------
async function sendMessage(matchId, message) {
  const user = await getUser();
  if (!user) return showMessage("Please login first.");

  if (!message || !message.trim()) return;

  const { error } = await db.from("messages").insert({
    match_id: matchId,
    sender_id: user.id,
    body: message.trim()
  });

  if (error) return showMessage(error.message);
}

// ---------- LOAD CHAT ----------
async function loadChat(matchId) {
  const { data, error } = await db
    .from("messages")
    .select("*")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return data || [];
}

// ---------- ADMIN CHECK ----------
async function isAdmin() {
  const user = await getUser();
  if (!user) return false;

  const { data, error } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return false;

  return data?.role === "admin";
}

// ---------- ADMIN USERS ----------
async function adminUsers() {
  if (!(await isAdmin())) {
    showMessage("Admin access denied.");
    return [];
  }

  const { data, error } = await db
    .from("profiles")
    .select("*");

  if (error) return [];

  return data || [];
}

// ---------- ADMIN CHANGE STATUS ----------
async function adminSetStatus(userId, status) {
  if (!(await isAdmin())) {
    showMessage("Admin access denied.");
    return;
  }

  const { error } = await db
    .from("profiles")
    .update({ status })
    .eq("id", userId);

  if (error) return showMessage(error.message);
  showMessage("Status updated.");
}

// ---------- SESSION ----------
async function checkSession() {
  const user = await getUser();
  console.log("Secret Meet session:", user ? "logged in" : "logged out");
  return user;
}

// ---------- GLOBAL ACCESS ----------
window.SecretMeet = {
  db,
  signup,
  login,
  logout,
  getUser,
  loadProfile,
  updateProfile,
  findMatches,
  likeUser,
  loadMatches,
  sendMessage,
  loadChat,
  isAdmin,
  adminUsers,
  adminSetStatus,
  checkSession
};

checkSession();
