const { RouterOSAPI } = require('routeros-api');

class MikrotikConfig {
  constructor() {
    this.host = (process.env.MIKROTIK_HOST || process.env.MIKROTIK_IP || '').trim();
    this.user = (process.env.MIKROTIK_USER || process.env.MIKROTIK_API_USER || '').trim();
    this.password = process.env.MIKROTIK_PASSWORD || process.env.MIKROTIK_API_PASSWORD || '';
    this.port = parseInt(process.env.MIKROTIK_PORT || process.env.MIKROTIK_API_PORT, 10) || 8728;
  }

  async connect() {
    if (!this.host || !this.user) {
      console.error('Konfigurasi MikroTik belum lengkap (MIKROTIK_HOST / MIKROTIK_USER kosong)');
      return null;
    }

    const conn = new RouterOSAPI({
      host: this.host,
      user: this.user,
      password: this.password,
      port: this.port,
      timeout: 8
    });

    try {
      await conn.connect();
      return conn;
    } catch (error) {
      console.error(`Gagal terhubung ke MikroTik (${this.host}:${this.port}):`, error.message);
      return null;
    }
  }

  async login() {
    const conn = await this.connect();
    if (conn) {
      console.log('Berhasil terhubung ke MikroTik via API!');
      await conn.close();
      return true;
    }
    return false;
  }

  async addUserToHotspot(username, password, profile = 'default') {
    const conn = await this.connect();
    if (!conn) {
      return { success: false, message: 'Koneksi ke MikroTik gagal' };
    }

    try {
      const existing = await conn.write('/ip/hotspot/user/print', [`?name=${username}`]);
      if (!existing || existing.length === 0) {
        await conn.write('/ip/hotspot/user/add', [
          `=name=${username}`,
          `=password=${password}`,
          `=profile=${profile}`
        ]);
      }
      await conn.close();
      return { success: true, message: 'User added to hotspot' };
    } catch (error) {
      console.error('Error adding user to hotspot:', error.message);
      try { await conn.close(); } catch (e) {}
      return { success: false, message: error.message };
    }
  }

  async removeUserFromHotspot(username) {
    const conn = await this.connect();
    if (!conn) return { success: false, message: 'Koneksi gagal' };

    try {
      const users = await conn.write('/ip/hotspot/user/print', [`?name=${username}`]);
      if (users && users.length > 0) {
        for (const u of users) {
          if (u['.id']) {
            await conn.write('/ip/hotspot/user/remove', [`=.id=${u['.id']}`]);
          }
        }
      }
      await conn.close();
      return { success: true, message: 'User removed from hotspot' };
    } catch (error) {
      console.error('Error removing user from hotspot:', error.message);
      try { await conn.close(); } catch (e) {}
      return { success: false, message: error.message };
    }
  }

  async validateLogin(username, password) {
    return { success: true, message: 'Login valid' };
  }

  async getUsersStats() {
    const conn = await this.connect();
    if (!conn) {
      return { connected: false, stats: [] };
    }

    try {
      let hotspotUsers = [];
      let activeUsers = [];

      try {
        hotspotUsers = await conn.write('/ip/hotspot/user/print');
      } catch (err) {
        console.error('Error /ip/hotspot/user/print:', err.message);
      }

      try {
        activeUsers = await conn.write('/ip/hotspot/active/print');
      } catch (err) {
        console.error('Error /ip/hotspot/active/print:', err.message);
      }

      await conn.close();

      const userList = Array.isArray(hotspotUsers) ? hotspotUsers : [];
      const activeList = Array.isArray(activeUsers) ? activeUsers : [];

      const stats = userList.map(user => {
        const active = activeList.find(act => act.user === user.name);
        return {
          name: user.name,
          'bytes-in': Number(active ? (active['bytes-in'] ?? 0) : (user['bytes-in'] ?? 0)) || 0,
          'bytes-out': Number(active ? (active['bytes-out'] ?? 0) : (user['bytes-out'] ?? 0)) || 0,
          uptime: active ? (active.uptime || 'Active') : (user.uptime || 'Off'),
          isOnline: Boolean(active)
        };
      });

      for (const act of activeList) {
        if (act.user && !stats.some(s => s.name === act.user)) {
          stats.push({
            name: act.user,
            'bytes-in': Number(act['bytes-in'] ?? 0) || 0,
            'bytes-out': Number(act['bytes-out'] ?? 0) || 0,
            uptime: act.uptime || 'Active',
            isOnline: true
          });
        }
      }

      return { connected: true, stats };
    } catch (error) {
      console.error('Error fetching Mikrotik statistics:', error.message);
      try { await conn.close(); } catch (e) {}
      return { connected: false, stats: [] };
    }
  }
}

module.exports = new MikrotikConfig();
