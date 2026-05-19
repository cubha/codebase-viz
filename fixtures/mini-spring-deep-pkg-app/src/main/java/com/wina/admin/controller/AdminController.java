package com.wina.admin.controller;

import com.wina.admin.service.AdminService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminService service;

    public AdminController(AdminService service) {
        this.service = service;
    }

    @GetMapping("/users") public String users() { return service.users(); }
    @PostMapping("/audit") public String audit(@RequestBody String body) { return service.audit(body); }
}
