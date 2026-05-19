package com.wina.partner.order.service;

import com.wina.partner.order.repository.OrderRepository;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }

    public String findAll() { return ""; }
    public String place(String body) { return ""; }
    public String cancel(Long id) { return ""; }
}
