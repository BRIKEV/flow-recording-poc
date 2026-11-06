import pg from 'pg';

export const createPool = (url: string) => new pg.Pool({ connectionString: url });

export const schema = `
  create table if not exists orders (
    id serial primary key,
    item text not null,
    quantity int not null,
    status text not null default 'pending'
  );
  create table if not exists payments (
    id serial primary key,
    order_id int not null references orders (id),
    amount numeric not null
  );
`;
