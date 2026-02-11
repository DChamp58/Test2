import React, { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

const supabaseUrl = `https://${projectId}.supabase.co`;
const supabase = createClient(supabaseUrl, publicAnonKey);

interface User {
  id: string;
  email: string;
  name: string;
  subscriptionTier: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  updateProfile: (profile: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session && !error) {
        setAccessToken(session.access_token);
        await fetchProfile(session.access_token);
      }
    } catch (error) {
      console.error('Session check error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async (token: string) => {
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-0dcf88a1/profile`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (response.ok) {
        const { profile } = await response.json();
        setUser(profile);
      }
    } catch (error) {
      console.error('Profile fetch error:', error);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-0dcf88a1/signup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ email, password, name }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to sign up');
    }

    // Now sign in
    await signIn(email, password);
  };

  const signIn = async (email: string, password: string) => {
    const { data: { session }, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (!session) throw new Error('No session returned');

    setAccessToken(session.access_token);
    await fetchProfile(session.access_token);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAccessToken(null);
  };

  const updateProfile = (profile: User) => {
    setUser(profile);
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, signIn, signUp, signOut, loading, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}