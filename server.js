require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const storageConfig = require('./config/storage');
const mikrotikConfig = require('./config/mikrotik');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, username, password } = req.body;

    if (!name || !email || !phone || !username || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const existingUser = await storageConfig.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    await storageConfig.addUser({ name, email, phone, username, password });

    res.json({ success: true, message: 'Registration successful. Please wait for admin approval.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await storageConfig.getAllUsers();

    let mikrotikConnected = false;
    let mikrotikStats = [];

    if (typeof mikrotikConfig.getUsersStats === 'function') {
      const result = await mikrotikConfig.getUsersStats();
      if (Array.isArray(result)) {
        mikrotikStats = result;
        mikrotikConnected = result.length > 0;
      } else if (result && typeof result === 'object') {
        mikrotikConnected = Boolean(result.connected);
        mikrotikStats = Array.isArray(result.stats) ? result.stats : [];
      }
    }

    const enrichedUsers = users.map(user => {
      const targetName = String(user.username || '').trim().toLowerCase();
      const stats = mikrotikStats.find(s => {
        const statName = String(s.name || s.user || '').trim().toLowerCase();
        return statName && statName === targetName;
      }) || {};

      const bytesIn = Number(stats['bytes-in'] ?? stats.bytesIn ?? 0) || 0;
      const bytesOut = Number(stats['bytes-out'] ?? stats.bytesOut ?? 0) || 0;
      const uptime = stats.uptime || 'Off';

      return {
        ...user,
        bytesIn,
        bytesOut,
        uptime,
        stats: {
          'bytes-in': bytesIn,
          'bytes-out': bytesOut,
          uptime
        }
      };
    });

    res.json({
      success: true,
      mikrotikConnected,
      users: enrichedUsers
    });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ success: false, message: 'Failed to get users' });
  }
});

app.post('/api/approve', async (req, res) => {
  try {
    const { username, adminName } = req.body;

    if (!username || !adminName) {
      return res.status(400).json({ success: false, message: 'Username and admin name are required' });
    }

    await storageConfig.approveUser(username, adminName);

    const userData = await storageConfig.getUserByUsername(username);
    if (userData) {
      await mikrotikConfig.addUserToHotspot(userData.username, userData.password);
    }

    res.json({ success: true, message: 'User approved successfully' });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ success: false, message: 'Approval failed' });
  }
});

app.post('/api/reject', async (req, res) => {
  try {
    const { username, adminName } = req.body;

    if (!username || !adminName) {
      return res.status(400).json({ success: false, message: 'Username and admin name are required' });
    }

    await storageConfig.rejectUser(username, adminName);

    res.json({ success: true, message: 'User rejected successfully' });
  } catch (error) {
    console.error('Rejection error:', error);
    res.status(500).json({ success: false, message: 'Rejection failed' });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;

    await storageConfig.deleteUser(username);
    await mikrotikConfig.removeUserFromHotspot(username);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Deletion error:', error);
    res.status(500).json({ success: false, message: 'Deletion failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await storageConfig.getUserByUsername(username);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({ success: false, message: 'User not approved yet' });
    }

    const mikrotikResult = await mikrotikConfig.validateLogin(username, password);

    if (mikrotikResult.success) {
      res.json({ success: true, message: 'Login successful', user: { name: user.name, username: user.username } });
    } else {
      res.status(401).json({ success: false, message: mikrotikResult.message });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

app.get('/api/status/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await storageConfig.getUserByUsername(username);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, status: user.status });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ success: false, message: 'Status check failed' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true, message: 'Admin login successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid admin password' });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
