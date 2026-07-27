use crate::{station_adapter::Station, Store};
use rusqlite::{params, Row};

fn station(row: &Row<'_>) -> rusqlite::Result<Station> {
    Ok(Station {
        id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?, kind: row.get(3)?, status: row.get(4)?,
        last_synced_at: row.get(5)?, last_error: row.get(6)?,
    })
}

pub(crate) trait StationStore {
    fn list_stations(&self) -> Result<Vec<Station>, String>;
    fn get_station(&self, id: &str) -> Result<Station, String>;
    fn save_station(&self, station: &Station) -> Result<(), String>;
    fn delete_station(&self, id: &str) -> Result<(), String>;
}

impl StationStore for Store {
    fn list_stations(&self) -> Result<Vec<Station>, String> {
        let mut statement = self.connection.prepare("SELECT id, name, base_url, kind, status, last_synced_at, last_error FROM stations ORDER BY name").map_err(|error| error.to_string())?;
        let stations = statement.query_map([], station).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        Ok(stations)
    }

    fn get_station(&self, id: &str) -> Result<Station, String> {
        self.connection.query_row("SELECT id, name, base_url, kind, status, last_synced_at, last_error FROM stations WHERE id=?1", [id], station).map_err(|error| error.to_string())
    }

    fn save_station(&self, station: &Station) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO stations (id,name,base_url,kind,status,last_synced_at,last_error) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![station.id, station.name, station.base_url, station.kind, station.status, station.last_synced_at, station.last_error]).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn delete_station(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM stations WHERE id=?1", [id]).map_err(|error| error.to_string())?;
        self.connection.execute("DELETE FROM snapshots WHERE station_id=?1", [id]).map_err(|error| error.to_string())?;
        Ok(())
    }
}
