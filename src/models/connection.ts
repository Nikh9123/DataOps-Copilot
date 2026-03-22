export type DataPlatformType = "snowflake" | "databricks" | "airflow";

export type Connection = {
  id: string;
  name: string;
  type: DataPlatformType;
  config: {
    account: string;
    username: string;
    warehouseId?: string;
    airflowAuthType?: "basic" | "token";
    password?: string;
    accessToken?: string;
  };
};

export type StoredConnectionMetadata = Omit<Connection, "config"> & {
  config: {
    account: string;
    username: string;
    warehouseId?: string;
    airflowAuthType?: "basic" | "token";
  };
};

export type StoredConnectionSecret = {
  password?: string;
  accessToken?: string;
};
