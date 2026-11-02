

"use strict";

const SUPABASE_URL =

  "https://fkfgimyelgvlsbtxhvih.supabase.co";



const SUPABASE_ANON_KEY =

  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +

  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrZmdpbXllbGd2bHNidHhodmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NDY1MzgsImV4cCI6MjA5NzQyMjUzOH0." +

  "gZT9mgZtSOpWYs7PkQ8RYmuMI3UgXLwxsYCQfbWtwFM";

const LOGIN_ACCOUNTS = {

  admin: "admin@gmail.com",

  operator: "glips@gmail.com"

};

let loginSupabase = null;

let loginReady = false;

let isLoggingIn = false;

document.addEventListener(

  "DOMContentLoaded",

  async () => {

    restoreRememberedUsername();

    initializeLoginEvents();

    await initializeSupabaseAuth();

  }

);

function restoreRememberedUsername() {

  const savedUsername =

    localStorage.getItem("lpg_remember_user");



  if (!savedUsername) return;



  const usernameInput =

    document.getElementById("username");



  const rememberCheckbox =

    document.getElementById("rememberMe");



  if (usernameInput) {

    usernameInput.value = savedUsername;

  }



  if (rememberCheckbox) {

    rememberCheckbox.checked = true;

  }

}

function initializeLoginEvents() {

  const usernameInput =

    document.getElementById("username");



  const passwordInput =

    document.getElementById("password");



  usernameInput?.addEventListener(

    "keydown",

    event => {

      if (event.key === "Enter") {

        event.preventDefault();

        passwordInput?.focus();

      }

    }

  );



  passwordInput?.addEventListener(

    "keydown",

    event => {

      if (event.key === "Enter") {

        event.preventDefault();

        handleLogin();

      }

    }

  );



  usernameInput?.addEventListener(

    "input",

    () => {

      hideError();

      markError([]);

    }

  );



  passwordInput?.addEventListener(

    "input",

    () => {

      hideError();

      markError([]);

    }

  );

}

async function initializeSupabaseAuth() {

  try {

    if (

      !window.supabase ||

      typeof window.supabase.createClient !== "function"

    ) {

      throw new Error(

        "Supabase JavaScript library failed to load."

      );

    }



    loginSupabase = window.supabase.createClient(

      SUPABASE_URL,

      SUPABASE_ANON_KEY,

      {

        auth: {

          persistSession: true,

          autoRefreshToken: true,

          detectSessionInUrl: true

        }

      }

    );



    loginReady = true;



    console.log(

      "[GLiPS Login] Supabase initialized."

    );



    // Always show the login form when login.html is opened.
    // Do not automatically redirect using a previously saved Supabase session.
    // The loading transition runs only after a successful Sign In action.


  } catch (error) {

    loginReady = false;

    loginSupabase = null;



    console.error(

      "[GLiPS Login] Initialization:",

      error

    );



    showError(

      "Authentication service is unavailable. Check your internet connection and refresh."

    );

  }

}

function togglePassword() {

  const passwordInput =

    document.getElementById("password");



  const eyeIcon =

    document.getElementById("eyeIcon");



  if (!passwordInput) return;



  const showPassword =

    passwordInput.type === "password";



  passwordInput.type = showPassword

    ? "text"

    : "password";



  if (eyeIcon) {

    eyeIcon.className = showPassword

      ? "ti ti-eye-off"

      : "ti ti-eye";

  }

}

function showError(message) {

  const errorBox =

    document.getElementById("errorMsg");



  const errorText =

    document.getElementById("errorText");



  if (errorBox) {

    errorBox.style.display = "flex";

    errorBox.style.animation = "none";



    void errorBox.offsetHeight;



    errorBox.style.animation =

      "shake .4s ease";

  }



  if (errorText) {

    errorText.textContent = message;

  }

}



function hideError() {

  const errorBox =

    document.getElementById("errorMsg");



  if (errorBox) {

    errorBox.style.display = "none";

  }

}

function markError(ids = []) {

  ["username", "password"].forEach(

    id => {

      const input =

        document.getElementById(id);



      if (!input) return;



      input.classList.toggle(

        "error",

        ids.includes(id)

      );

    }

  );

}

function setLoading(loading) {

  const loginButton =

    document.getElementById("loginBtn");



  const buttonText =

    document.getElementById("btnText");



  const buttonLoader =

    document.getElementById("btnLoader");



  if (loginButton) {

    loginButton.disabled = loading;

  }



  if (buttonText) {

    buttonText.style.display =

      loading ? "none" : "flex";

  }



  if (buttonLoader) {

    buttonLoader.style.display =

      loading ? "flex" : "none";

  }

}

async function handleLogin() {

  if (isLoggingIn) return;



  hideError();

  markError([]);



  const usernameInput =

    document.getElementById("username");



  const passwordInput =

    document.getElementById("password");



  const rememberCheckbox =

    document.getElementById("rememberMe");



  const username =

    usernameInput?.value.trim() || "";



  const password =

    passwordInput?.value || "";

  if (!username && !password) {

    showError(

      "Please enter your username and password."

    );



    markError([

      "username",

      "password"

    ]);



    usernameInput?.focus();

    return;

  }



  if (!username) {

    showError(

      "Please enter your username."

    );



    markError(["username"]);

    usernameInput?.focus();

    return;

  }



  if (!password) {

    showError(

      "Please enter your password."

    );



    markError(["password"]);

    passwordInput?.focus();

    return;

  }

  if (!loginReady || !loginSupabase) {

    showError(

      "Authentication service is unavailable. Please refresh the page."

    );



    return;

  }

  const normalizedUsername =

    username.toLowerCase();



  const email =

    LOGIN_ACCOUNTS[normalizedUsername];



  if (!email) {

    showError(

      "Invalid username or password."

    );



    markError([

      "username",

      "password"

    ]);



    return;

  }



  isLoggingIn = true;

  setLoading(true);

  try {

    const { data, error } =

      await loginSupabase.auth.signInWithPassword({

        email,

        password

      });



    if (error) {

      throw error;

    }



    if (!data?.session?.access_token) {

      throw new Error(

        "No authentication session returned."

      );

    }



    const authenticatedEmail =

      data.user?.email?.toLowerCase();



    if (

      authenticatedEmail !==

      email.toLowerCase()

    ) {

      await loginSupabase.auth.signOut();



      throw new Error(

        "Authenticated account does not match selected username."

      );

    }

    if (rememberCheckbox?.checked) {

      localStorage.setItem(

        "lpg_remember_user",

        normalizedUsername

      );

    } else {

      localStorage.removeItem(

        "lpg_remember_user"

      );

    }

    sessionStorage.setItem(

      "lpg_logged_in",

      "true"

    );



    sessionStorage.setItem(

      "lpg_user",

      normalizedUsername

    );



    console.log(

      "[GLiPS Login] Login successful:",

      normalizedUsername

    );

    await showGLiPSLoginTransition();
    window.location.replace("dashboard.html");



  } catch (error) {

    console.error(

      "[GLiPS Login] Sign-in error:",

      error

    );



    showError(

      error.message ===

      "Invalid login credentials"

        ? "Incorrect username or password."

        : "Unable to sign in. Please check your account and try again."

    );



    markError([

      "username",

      "password"

    ]);



    passwordInput?.select();



  } finally {

    isLoggingIn = false;

    setLoading(false);

  }

}


// Display the transition only after Supabase authentication has succeeded.
function showGLiPSLoginTransition() {
  const overlay = document.getElementById("glipsTransition");
  if (!overlay) return Promise.resolve();
  overlay.classList.add("is-visible");
  overlay.setAttribute("aria-hidden", "false");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise(resolve => window.setTimeout(resolve, reduceMotion ? 100 : 1250));
}
