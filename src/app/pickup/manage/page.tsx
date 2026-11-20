"use client";
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
export default function PickupManage() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [invite, setInvite] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [signedIn, setSignedIn] = useState(false);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const account = await signInWithEmailAndPassword(auth, email, password);
      const token = await account.user.getIdToken(true);
      const response = await fetch("/api/pickup/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "login" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPassword("");
      setSignedIn(true);
      setMessage("Signed in. Open coordinator tools below.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/pickup/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grant", email: invite }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage(body.message);
      setInvite("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" style={{ maxWidth: 560, margin: "2rem auto" }}>
      <h1>Pickup coordinator access</h1>
      <p>
        Use your existing Front Range Food Source account. Volunteers only need
        a paired iPad.
      </p>
      <form onSubmit={login} className="flex flex-col gap-md">
        <label>
          Email
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          Sign in
        </button>
      </form>
      <p role="status" style={{ margin: "1rem 0" }}>
        {message}
      </p>
      <p>
        <a href="/pickup?coordinator=1">Open coordinator tools</a> ·{" "}
        <a href="/pickup">Open staff check-in</a>
      </p>
      {signedIn && (
        <>
          <form onSubmit={grant} style={{ marginTop: 24 }}>
            <h2>Add another coordinator</h2>
            <p>
              Application administrators can grant pickup access to an existing
              Firebase account. Share this page’s address with them.
            </p>
            <label>
              Coordinator email
              <input
                className="input"
                type="email"
                required
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
            </label>
            <button className="btn" disabled={busy}>
              Grant pickup access
            </button>
          </form>
          <button
            className="btn"
            onClick={async () => {
              await fetch("/api/pickup/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              setSignedIn(false);
              setMessage("Coordinator browser session ended.");
            }}
          >
            Sign out of coordinator tools
          </button>
        </>
      )}
    </section>
  );
}
