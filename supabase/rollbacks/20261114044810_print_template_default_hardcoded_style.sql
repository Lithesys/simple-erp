update public.print_templates
set content = $legacy_default$# {{store.name}}

**{{invoice.document_title}}**\
**Mã đơn:** {{invoice.order_no}}\
**Ngày:** {{invoice.created_at}}

---

**Tên KH:** {{invoice.customer_name}}\
**Địa chỉ:** {{invoice.customer_address}}\
**SĐT:** {{invoice.customer_phone}}\
**Thu ngân:** {{invoice.cashier_name}}

{{invoice.items_table}}

**Tổng tiền hàng:** {{invoice.subtotal}}\
**Giảm:** {{invoice.discount}}\
**Thanh toán:** {{invoice.total}}

*Cảm ơn quý khách, hẹn gặp lại!*$legacy_default$,
    updated_at = now()
where is_default
  and name = 'Mẫu in hóa đơn'
  and rtrim(content, ' ' || chr(9) || chr(10) || chr(13)) = rtrim($new_default$# {{store.name}}

:::print-align=center
{{invoice.document_title}}
:::

:::print-align=center
{{invoice.created_at}}
:::

---

Mã đơn: {{invoice.order_no}}

Khách hàng: **{{invoice.customer_name}}**

Số điện thoại: {{invoice.customer_phone}}

Địa chỉ: {{invoice.customer_address}}

Bảng giá: {{invoice.price_list_name}}

Ghi chú: {{invoice.note}}

| Hàng hóa | ĐVT | SL | Giá | Tiền |
| :--- | :--- | ---: | ---: | ---: |
| **{{invoice.item.name}}** | {{invoice.item.unit}} | {{invoice.item.quantity}} | {{invoice.item.unit_price}} | {{invoice.item.line_total}} |

---

| Tổng tiền hàng | **{{invoice.subtotal}}** |
| :--- | ---: |
| Giảm giá | **{{invoice.discount}}** |
| **THANH TOÁN** | **{{invoice.total}}** |

:::print-align=center
Xin cảm ơn quý khách!
:::
$new_default$, ' ' || chr(9) || chr(10) || chr(13));
