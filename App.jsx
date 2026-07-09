import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend 
} from 'recharts';
import './App.css';

function App() {
  // --- AUTHENTICATION STATE ---
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('isAdmin') === 'true');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authError, setAuthError] = useState('');

  // --- APP STATE ---
  const [question, setQuestion] = useState('');
  const [sqlQuery, setSqlQuery] = useState('');
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [schema, setSchema] = useState(null);
  const [showSchema, setShowSchema] = useState(false);

  // --- ADMIN STATE ---
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminTab, setAdminTab] = useState('logs'); 
  const [adminLogs, setAdminLogs] = useState([]);
  const [logSearch, setLogSearch] = useState('');
  const [adminCurrentPage, setAdminCurrentPage] = useState(1);
  const logsPerPage = 10;

  // Settings State 
  const [rowLimit, setRowLimit] = useState(500);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are an expert MySQL data analyst.\nWrite a valid MySQL SELECT query to answer the user's CURRENT QUESTION.\nUse ONLY the tables and columns provided in the schema below."
  );
  const [settingsSaved, setSettingsSaved] = useState(false);

  // MOCK ANALYTICS DATA 
  const queryVolumeData = [
    { name: 'Mon', queries: 120 }, { name: 'Tue', queries: 150 },
    { name: 'Wed', queries: 180 }, { name: 'Thu', queries: 140 },
    { name: 'Fri', queries: 210 }, { name: 'Sat', queries: 65 }, { name: 'Sun', queries: 80 }
  ];
  
  const errorRateData = [
    { name: 'Successful', value: 850 },
    { name: 'Failed / Retried', value: 150 }
  ];
  const COLORS = ['#2ECC71', '#E74C3C']; 

  const activeUsersData = [
    { name: 'demo_user', queries: 342 },
    { name: 'sarah_m', queries: 289 },
    { name: 'admin', queries: 156 },
    { name: 'raj_data', queries: 120 }
  ];

  // --- CHART HELPERS ---
  const getChartConfig = () => {
    if (results.length === 0) return null;
    const sampleRow = results[0];
    let xAxisKey = null;
    let yAxisKey = null;

    Object.keys(sampleRow).forEach(key => {
      if (typeof sampleRow[key] === 'string' && !xAxisKey) xAxisKey = key;
      if (typeof sampleRow[key] === 'number' && !yAxisKey) yAxisKey = key;
    });

    if (xAxisKey && yAxisKey) return { xAxisKey, yAxisKey };
    return null;
  };
  const chartConfig = getChartConfig();

  // --- AUTHENTICATION METHODS ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLoginMode) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch('http://localhost:8000/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData
        });

        if (!res.ok) throw new Error('Invalid credentials');
        const data = await res.json();
        setToken(data.access_token);
        setIsAdmin(data.is_admin);
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('isAdmin', data.is_admin);
      } else {
        const res = await fetch('http://localhost:8000/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Registration failed');
        }
        setIsLoginMode(true);
        setAuthError('Registration successful! Please log in.');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    setToken(null); setIsAdmin(false); setShowAdminPanel(false);
    localStorage.clear(); setUsername(''); setPassword('');
    setHistory([]); setSchema(null); setResults([]);
    setSqlQuery(''); setSummary(''); setLogSearch('');
    setAdminCurrentPage(1); setAdminTab('logs');
  };

  // --- DATA FETCHING ---
  useEffect(() => { if (token && showHistory) fetchHistory(); }, [showHistory, token]);

  useEffect(() => {
    if (token && showAdminPanel && adminTab === 'logs') {
      fetch('http://localhost:8000/admin/logs', { 
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => setAdminLogs(data))
      .catch(err => console.error("Failed to fetch admin logs", err));
    }
  }, [showAdminPanel, adminTab, token]);

  useEffect(() => {
    if (token && showAdminPanel && adminTab === 'settings') {
      fetch('http://localhost:8000/admin/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.row_limit) setRowLimit(data.row_limit);
      })
      .catch(err => console.error("Failed to fetch settings", err));
    }
  }, [showAdminPanel, adminTab, token]);

  useEffect(() => {
    const fetchSchema = async () => {
      if (!token) return;
      try {
        const res = await fetch('http://localhost:8000/schema', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) setSchema(await res.json());
      } catch (err) { console.error("Failed to fetch schema", err); }
    };
    fetchSchema();
  }, [token]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('http://localhost:8000/history', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setHistory(await res.json());
    } catch (err) { console.error("Failed to fetch history", err); }
  };

  const handleQuerySubmit = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true); setError(''); setSqlQuery(''); setResults([]); setSummary('');

    try {
      const response = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ question }),
      });
      if (response.status === 401) { handleLogout(); throw new Error('Session expired. Please log in again.'); }
      if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
      
      const data = await response.json();
      if (data.error) { setError(data.error); } 
      else {
        setSqlQuery(data.sql); setResults(data.results); setSummary(data.summary || '');
        if (showHistory) fetchHistory();
      }
    } catch (err) { setError(err.message || 'Failed to connect to the backend.'); } 
    finally { setLoading(false); }
  };

  const saveAdminSettings = async () => {
    try {
      const response = await fetch('http://localhost:8000/admin/settings', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ row_limit: rowLimit })
      });

      if (!response.ok) throw new Error("Failed to save settings");
      
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings to the server.");
    }
  };

  // --- CSV EXPORTS ---
  const exportToCSV = () => {
    if (results.length === 0) return;
    const headers = Object.keys(results[0]);
    const csvRows = results.map(row => 
      headers.map(header => {
        const val = row[header] !== null ? row[header].toString() : '';
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',')
    );
    triggerDownload([headers.join(','), ...csvRows].join('\n'), 'query_results.csv');
  };

  const exportAdminLogsToCSV = () => {
    if (filteredAdminLogs.length === 0) return;
    const headers = ['User', 'Question', 'Generated SQL', 'Timestamp'];
    const csvRows = filteredAdminLogs.map(log => [
        `"${log.username}"`, `"${(log.question || '').replace(/"/g, '""')}"`,
        `"${(log.sql || '').replace(/"/g, '""')}"`, `"${new Date(log.date).toLocaleString()}"`
    ].join(','));
    triggerDownload([headers.join(','), ...csvRows].join('\n'), 'admin_audit_logs.csv');
  };

  const triggerDownload = (csvContent, fileName) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- ADMIN LOGIC ---
  const filteredAdminLogs = adminLogs.filter((log) => {
    const searchLower = logSearch.toLowerCase();
    return (
      log.username.toLowerCase().includes(searchLower) ||
      log.question.toLowerCase().includes(searchLower) ||
      log.sql.toLowerCase().includes(searchLower)
    );
  });
  const indexOfLastLog = adminCurrentPage * logsPerPage;
  const currentLogs = filteredAdminLogs.slice(indexOfLastLog - logsPerPage, indexOfLastLog);
  const totalPages = Math.ceil(filteredAdminLogs.length / logsPerPage);
  useEffect(() => { setAdminCurrentPage(1); }, [logSearch]);

  // --- RENDER VIEWS ---
  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h2>{isLoginMode ? 'Welcome Back' : 'Create Account'}</h2>
          <p>Register as "admin" for God-mode access.</p>
          <form onSubmit={handleAuth} className="auth-form">
            <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit">{isLoginMode ? 'Login' : 'Register'}</button>
          </form>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="auth-switch" onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }}>
            {isLoginMode ? "Need an account? Register" : "Already have an account? Login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <div className="header-left">
          <h1>NL2SQL Query Assistant</h1>
          <p>Transform natural language into SQL queries powered by AI</p>
        </div>
        <div className="header-actions">
          {isAdmin && (
            <button className="toggle-btn admin-btn" onClick={() => setShowAdminPanel(!showAdminPanel)}>
              {showAdminPanel ? 'Exit Admin' : 'Admin Dashboard'}
            </button>
          )}
          {!showAdminPanel && <button className="toggle-btn" onClick={() => setShowSchema(!showSchema)}>{showSchema ? 'Close Schema' : 'View Schema'}</button>}
          {!showAdminPanel && <button className="toggle-btn" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Close History' : 'View History'}</button>}
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {showAdminPanel ? (
        <div className="admin-wrapper" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          
          <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid var(--border)', marginBottom: '2rem' }}>
            {['logs', 'analytics', 'settings'].map(tab => (
              <button 
                key={tab}
                onClick={() => setAdminTab(tab)}
                style={{
                  background: 'none', border: 'none', padding: '1rem', cursor: 'pointer', fontSize: '1.1rem',
                  fontWeight: adminTab === tab ? 'bold' : 'normal',
                  borderBottom: adminTab === tab ? '3px solid var(--primary)' : 'none',
                  color: adminTab === tab ? 'var(--primary)' : 'var(--text-color)'
                }}
              >
                {tab === 'logs' ? 'System Logs' : tab === 'analytics' ? 'System Analytics' : 'Governance & Settings'}
              </button>
            ))}
          </div>

          {/* TAB 1: LOGS */}
          {adminTab === 'logs' && (
            <div className="table-container admin-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2>Audit Trail ({filteredAdminLogs.length})</h2>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <input type="text" placeholder="Search logs..." value={logSearch} onChange={(e) => setLogSearch(e.target.value)} style={{ padding: '0.5rem', width: '300px' }} />
                  <button onClick={exportAdminLogsToCSV} className="export-btn" disabled={filteredAdminLogs.length === 0}>Download CSV</button>
                </div>
              </div>
              <table>
                <thead><tr><th>User</th><th>Question</th><th>Generated SQL</th><th>Timestamp</th></tr></thead>
                <tbody>
                  {currentLogs.length > 0 ? currentLogs.map((log) => (
                    <tr key={log.id}>
                      <td><strong>{log.username}</strong></td><td>{log.question}</td>
                      <td><code>{log.sql}</code></td><td>{new Date(log.date).toLocaleString()}</td>
                    </tr>
                  )) : <tr><td colSpan="4" style={{ textAlign: 'center' }}>No logs match your search.</td></tr>}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                  <button onClick={() => setAdminCurrentPage(p => Math.max(p - 1, 1))} disabled={adminCurrentPage === 1}>Previous</button>
                  <span>Page {adminCurrentPage} of {totalPages}</span>
                  <button onClick={() => setAdminCurrentPage(p => Math.min(p + 1, totalPages))} disabled={adminCurrentPage === totalPages}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ANALYTICS */}
          {adminTab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div className="chart-container" style={{ backgroundColor: 'var(--surface)', padding: '1.5rem', borderRadius: '8px' }}>
                <h3>Query Volume (Last 7 Days)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={queryVolumeData}>
                    <XAxis dataKey="name" /> <YAxis /> <Tooltip />
                    <Line type="monotone" dataKey="queries" stroke="var(--primary)" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-container" style={{ backgroundColor: 'var(--surface)', padding: '1.5rem', borderRadius: '8px' }}>
                <h3>AI Error Rate</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={errorRateData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" label>
                      {errorRateData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-container" style={{ gridColumn: 'span 2', backgroundColor: 'var(--surface)', padding: '1.5rem', borderRadius: '8px' }}>
                <h3>Most Active Users</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={activeUsersData}>
                    <XAxis dataKey="name" /> <YAxis /> <Tooltip />
                    <Bar dataKey="queries" fill="var(--secondary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* TAB 3: SETTINGS */}
          {adminTab === 'settings' && (
            <div style={{ display: 'grid', gap: '2rem', maxWidth: '800px' }}>
              <div style={{ backgroundColor: 'var(--surface)', padding: '2rem', borderRadius: '8px' }}>
                <h3>Prompt Engineering Studio</h3>
                <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>Modify the core instructions sent to the local LLM before SQL generation.</p>
                <textarea 
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  style={{ width: '100%', height: '150px', padding: '1rem', fontFamily: 'monospace', borderRadius: '4px', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ backgroundColor: 'var(--surface)', padding: '2rem', borderRadius: '8px' }}>
                <h3>Database Governance</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label><strong>Global Row Limit (Fallback)</strong></label>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Automatically appended to SELECT queries missing a limit to prevent memory crashes.</p>
                  <input 
                    type="number" 
                    value={rowLimit}
                    onChange={(e) => setRowLimit(Number(e.target.value))}
                    style={{ width: '150px', padding: '0.5rem', borderRadius: '4px' }}
                  />
                </div>
              </div>

              <button 
                onClick={saveAdminSettings}
                style={{ padding: '1rem', fontSize: '1.1rem', backgroundColor: settingsSaved ? '#2ECC71' : 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', transition: 'background-color 0.3s' }}
              >
                {settingsSaved ? 'Settings Saved Successfully!' : 'Deploy Settings to Production'}
              </button>
            </div>
          )}

        </div>
      ) : (
        <div className="layout-wrapper">
          {showSchema && schema && (
            <aside className="sidebar left-sidebar">
              <h3>Database Schema</h3>
              <div className="schema-list">
                {Object.entries(schema).map(([tableName, columns]) => (
                  <div key={tableName} className="schema-table">
                    <div className="table-name">{tableName}</div>
                    <div className="column-list">
                      {columns.map(col => (
                        <div key={col.name} className="column-item">
                          <span className="col-name">{col.name}</span><span className="col-type">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}

          <main className={`main-content ${(showSchema || showHistory) ? 'main-compressed' : 'main-full'}`}>
            <form onSubmit={handleQuerySubmit} className="query-form">
              <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g., Top 5 customers by revenue" disabled={loading} autoFocus />
              <button type="submit" disabled={loading || !question.trim()}>{loading ? 'Generating...' : 'Run Query'}</button>
            </form>

            {loading && <div className="empty-state" style={{ padding: '2rem' }}><span>⚙️ Generating SQL query...</span></div>}
            {error && <div className="error-message">{error}</div>}

            {sqlQuery && <div className="sql-container"><h3>Generated SQL</h3><pre><code>{sqlQuery}</code></pre></div>}
            
            {summary && <div className="summary-box" style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', borderLeft: '4px solid var(--primary)' }}><strong>💡 AI Insight:</strong> {summary}</div>}

            {results.length > 0 && chartConfig && (
              <div className="chart-container" style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={results}>
                    <XAxis dataKey={chartConfig.xAxisKey} stroke="var(--text-muted)" /> <YAxis stroke="var(--text-muted)" />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border)' }} />
                    <Bar dataKey={chartConfig.yAxisKey} fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {results.length > 0 && (
              <div className="table-container">
                <div className="table-header">
                  <h3>Results ({results.length} rows)</h3>
                  <button onClick={exportToCSV} className="export-btn">Download CSV</button>
                </div>
                <table>
                  <thead><tr>{Object.keys(results[0]).map((key) => <th key={key}>{key}</th>)}</tr></thead>
                  <tbody>{results.map((row, idx) => <tr key={idx}>{Object.values(row).map((val, i) => <td key={i}>{val !== null ? val.toString() : 'NULL'}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            {!loading && !error && sqlQuery && results.length === 0 && <div className="empty-state">No results found for this query.</div>}
          </main>

          {showHistory && (
            <aside className="sidebar right-sidebar">
              <h3>Query History</h3>
              {history.length === 0 ? <p className="text-muted">No queries run yet.</p> : (
                <div className="history-list">
                  {history.map((item) => (
                    <div key={item.id} className="history-card" onClick={() => setQuestion(item.question)}>
                      <div className="history-q">{item.question}</div>
                      <div className="history-date">{new Date(item.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

export default App;