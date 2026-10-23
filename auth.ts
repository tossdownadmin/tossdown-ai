import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
export const { handlers, auth } = NextAuth({ providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })], callbacks: { async signIn({ user }) { return Boolean(user.email?.toLowerCase().endsWith("@tossdown.com")); } }, pages: { signIn: "/" } });
