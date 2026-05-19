package com.wina.partner.order.controller;

import com.wina.partner.order.service.OrderService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/partner/orders")
public class OrderController {
    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    @GetMapping public String list() { return service.findAll(); }
    @PostMapping public String place(@RequestBody String body) { return service.place(body); }
    @PostMapping("/{id}/cancel") public String cancel(@PathVariable Long id) { return service.cancel(id); }
}
