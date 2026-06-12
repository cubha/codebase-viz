package com.wina.partner.common.commonPop.service;

import com.wina.partner.common.commonPop.repository.PerfStatusRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PerfStatusServiceImpl implements PerfStatusService {

    private final PerfStatusRepository perfStatusRepository;

    @Override
    public Object retrievePerfStatus() {
        return perfStatusRepository.selectPerfStatus();
    }
}
