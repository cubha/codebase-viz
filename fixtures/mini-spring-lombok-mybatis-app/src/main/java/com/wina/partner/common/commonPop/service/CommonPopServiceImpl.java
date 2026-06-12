package com.wina.partner.common.commonPop.service;

import com.wina.partner.common.commonPop.repository.CommonPopRepository;
import com.wina.partner.common.commonPop.repository.OrderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class CommonPopServiceImpl implements CommonPopService {

    private final CommonPopRepository commonPopRepository;
    private final OrderRepository orderRepository;

    @Override
    public Object retrieveAgencyPopup() {
        return commonPopRepository.selectAgencyPopup();
    }

    @Override
    public Object savePrdoWryLabelYn(Object updateList) {
        orderRepository.updateLabelYn(updateList);
        return commonPopRepository.savePrdoWryLabelYn(updateList);
    }
}
