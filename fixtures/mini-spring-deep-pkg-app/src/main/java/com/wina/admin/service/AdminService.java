package com.wina.admin.service;

import com.wina.admin.repository.AdminRepository;
import org.springframework.stereotype.Service;

@Service
public class AdminService {
    private final AdminRepository repository;

    public AdminService(AdminRepository repository) {
        this.repository = repository;
    }

    public String users() { return ""; }
    public String audit(String body) { return ""; }
}
