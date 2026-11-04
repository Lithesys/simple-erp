export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
};

export function customerValues(
  customer: Pick<Customer, "name" | "phone" | "address">,
) {
  const values = {
    name: customer.name.trim(),
    phone: customer.phone.trim(),
    address: customer.address.trim(),
  };
  if (!values.name) throw new Error("Vui lòng nhập tên khách hàng.");
  if (
    values.name.length > 300 ||
    values.phone.length > 100 ||
    values.address.length > 1000
  )
    throw new Error("Thông tin khách hàng quá dài.");
  return values;
}
