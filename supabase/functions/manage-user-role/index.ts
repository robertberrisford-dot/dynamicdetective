import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id);
    
    const callerRoleList = (callerRoles || []).map(r => r.role);
    if (!callerRoleList.includes('admin') && !callerRoleList.includes('ops_lead')) {
      return new Response(JSON.stringify({ error: 'Forbidden: ops_lead role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { action, email, role } = body;

    // LIST action: return all auth users with their roles + vacation subs
    if (action === 'list') {
      const { data: { users }, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw listErr;
      const { data: allRoles } = await adminClient.from('user_roles').select('user_id, role');
      const roleMap: Record<string, string> = {};
      for (const r of (allRoles || [])) {
        const existing = roleMap[r.user_id];
        if (!existing || r.role === 'ops_lead' || r.role === 'admin' || (r.role === 'team_lead' && existing === 'editor')) {
          roleMap[r.user_id] = (r.role === 'admin' ? 'ops_lead' : r.role);
        }
      }
      const { data: editors } = await adminClient.from('editors').select('email, name, vacation_substitute_email');
      const nameMap: Record<string, string> = {};
      const vacationSubMap: Record<string, string | null> = {};
      const allEditorEmails = new Set<string>();
      for (const e of (editors || [])) {
        const lowerEmail = e.email.toLowerCase();
        allEditorEmails.add(lowerEmail);
        if (e.name && !nameMap[lowerEmail]) nameMap[lowerEmail] = e.name;
        if (!vacationSubMap[lowerEmail]) vacationSubMap[lowerEmail] = e.vacation_substitute_email || null;
      }
      const authUserEmails = new Set(users.map(u => u.email?.toLowerCase()).filter(Boolean));
      const result = users.map(u => ({
        id: u.id,
        email: u.email,
        name: nameMap[u.email?.toLowerCase() || ''] || u.user_metadata?.full_name || u.user_metadata?.name || null,
        role: roleMap[u.id] || 'editor',
        vacation_substitute_email: vacationSubMap[u.email?.toLowerCase() || ''] || null,
      }));
      // Add editors who haven't signed in yet
      for (const editorEmail of allEditorEmails) {
        if (!authUserEmails.has(editorEmail)) {
          result.push({
            id: `editor-${editorEmail}`,
            email: editorEmail,
            name: nameMap[editorEmail] || null,
            role: 'editor',
            vacation_substitute_email: vacationSubMap[editorEmail] || null,
          });
        }
      }
      result.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
      return new Response(JSON.stringify({ users: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // SET_VACATION_SUB action
    if (action === 'set_vacation_sub') {
      const { editor_email, substitute_email } = body;
      if (!editor_email) {
        return new Response(JSON.stringify({ error: 'editor_email is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      // Update all editor rows with this email
      const { error: updateErr } = await adminClient
        .from('editors')
        .update({ vacation_substitute_email: substitute_email || null })
        .ilike('email', editor_email);
      
      if (updateErr) throw updateErr;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!email || !role) {
      return new Response(JSON.stringify({ error: 'email and role are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!['editor', 'team_lead', 'ops_lead'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: { users }, error: listErr } = await adminClient.auth.admin.listUsers();
    if (listErr) throw listErr;
    
    const targetUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (role === 'editor') {
      if (targetUser) {
        await adminClient.from('user_roles').delete().eq('user_id', targetUser.id);
      }
      return new Response(JSON.stringify({ success: true, role: 'editor', has_account: !!targetUser }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!targetUser) {
      return new Response(JSON.stringify({ 
        error: `User ${email} has not signed in yet. They need to log in first before you can assign a role.` 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const appRole = role;
    await adminClient.from('user_roles').delete().eq('user_id', targetUser.id);
    const { error: insertErr } = await adminClient
      .from('user_roles')
      .insert({ user_id: targetUser.id, role: appRole });
    
    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({ success: true, role: appRole, user_id: targetUser.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
